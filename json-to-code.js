const { forEach } = require("advarr");
const count = require("deep-counter");
const declareVars = require("declare-vars");
const deconcat = require("deconcat");
const walk = require("deepest-walk");
const countNGrams = require("n-gram-counter");
const minQuote = require("min-quote");
const { genVarNames } = require("var-names");
const separo = require("separo");
const striptags = require("striptags");

const { forEachString, toString } = require("./utils");

const isQuoted = (str) => str.match(/^(['"`]).*\1$/);

const encode = ({ data, debug_level = 0, max_passes = 0, output = "module.exports" }) => {
  if (debug_level >= 1) console.log("[encode] starting");
  if (debug_level >= 2) console.log("[encode] data:", JSON.stringify(data).substring(0, 200), "...");
  const counts = count({ data, debug_level: debug_level - 1 });
  if (debug_level >= 1) console.log("counts:", counts);

  const stringified = typeof data === "string" ? data : JSON.stringify(data);
  if (debug_level >= 1) console.log("[encode] stringified:", stringified.substring(0, 200), "...");

  /* generate a UID for text operations */
  let uid;
  while (!uid) {
    const num = Math.floor(Math.random() * 1e5).toString();
    if (!stringified.includes(num)) uid = num;
  }
  if (debug_level >= 1) console.log("uid:", uid);

  // a number is always the first and last because there's not such thing as a sub-number (unlike a sub-string)
  const number_counts = Object.values(counts.numbers).map((it) => ({
    type: "number",
    value: it.value,
    count: it.count,
  }));

  const string_counts = Object.values(counts.strings).map((it) => ({
    type: "string",
    value: it.value,
    count: it.count,
    first: it.first,
    last: it.last,
  }));

  const all_counts = [...number_counts, ...string_counts];
  if (counts.null) {
    all_counts.push({
      type: "null",
      value: null,
      count: counts.null,
    });
  }
  if (counts.undefined) {
    all_counts.push({
      type: "undefined",
      value: undefined,
      count: counts.undefined,
    });
  }

  const sorted_counts = all_counts.sort((a, b) => Math.sign(b.count - a.count));
  if (debug_level >= 1) console.log("[encode] sorted counts");
  if (debug_level >= 2) console.log("[encode] sorted_counts:", sorted_counts);

  const tokens = sorted_counts.map((it) => {
    try {
      if (debug_level >= 2) console.log("it:", it);

      const { value, count, type } = it;

      const value_string = toString(value);

      if (["null", "number", "undefined"].includes(type)) {
        const value_length = value_string.length;
        const current_cost = count * value_length;
        const savings = {};
        for (let variable_length = 1; variable_length <= 5; variable_length++) {
          // like ,A=123; or ,Ba=null or ,Ab=undefined;
          const declaration_cost = 1 + variable_length + 1 + value_length;
          const replacement_cost = declaration_cost + count * variable_length;
          savings[variable_length] = current_cost - replacement_cost;
        }
        return { value, count, savings };
      } else if (type === "string") {
        const { first, last } = it;
        const percent_start = first / count;
        const percent_end = last / count;
        const not_percent_start = 1 - percent_start;
        const not_percent_end = 1 - percent_end;

        // if it is always preceeded by a space, we will later prepend a " " space
        const pad = first === 0;
        if (debug_level >= 2) console.log("pad:", pad);

        // how many characters the current value takes up
        const value_length = `${pad ? " " : ""}${value_string}`.length;
        if (debug_level >= 2) console.log("value_length:", value_length);

        const current_cost = count * value_length;
        if (debug_level >= 2) console.log("current_cost:", current_cost);

        const savings = {};
        for (let variable_length = 1; variable_length <= 5; variable_length++) {
          // like ,A='+lon_0=105'
          let declaration_length = 1 + variable_length + 1 + 1 + value_length + 1;

          // not factoring in that strings can be keys as well
          // will need to upgrade deep-counter to track additional stats like is the string a complete key, is the string part of a key and position, and is string a substring in a string
          // also need to factor in whether to prepend space or not
          // ?? maybe should factor in assuming strings are replaced before and after with variables ??
          const average_replacement_length = `"+`.length * not_percent_start + variable_length + `"+`.length * not_percent_end;
          // console.log("average_replacement_length:", average_replacement_length);

          const total_replacement_size = declaration_length + average_replacement_length * count;
          if (debug_level >= 3) console.log("total_replacement_size:", total_replacement_size);
          savings[variable_length] = current_cost - total_replacement_size;
        }
        if (debug_level >= 2) console.log("savings:", savings);
        return {
          value: (pad ? " " : "") + it.value,
          count: count,
          first,
          last,
          pad,
          savings,
        };
      }
    } catch (error) {
      throw error;
    }
  });
  if (debug_level >= 1) console.log(tokens);

  const varname2token = new Map();
  const token2varname = new Map();
  const gen = genVarNames();
  for (const varname of gen) {
    if (debug_level >= 2) console.log("varname:", varname);
    const varlen = varname.length;

    // sort tokens by saving for the given variable's length
    tokens.sort((a, b) => Math.sign(b.savings[varlen] - a.savings[varlen]));

    // pop out the first token
    const token = tokens.shift();

    // if we can save any space with the token with the most potential savings, break
    if (token.savings[varlen] <= 0) break;

    // console.log("token:", token);
    // save the selection

    varname2token.set(varname, { first: token.first, token: token.value });
    token2varname.set(token.value, { varname, first: token.first, value: token.value });
  }
  if (debug_level >= 1) console.log("assigned variable names to tokens");
  if (debug_level >= 2) console.log("token2name:", token2varname);

  // console.log("varname2token['U']:", varname2token['U']);

  // get a clone of the original data
  const result = JSON.parse(stringified);
  if (debug_level >= 1) console.log("cloned original data");
  if (debug_level >= 2) console.log("cloned data:", result);

  /*
    string operations
    <delprev> - deletes previous character
    <delnext> - deletes next character
  */
  const delprev = `<delprev-${uid}>`;
  const delnext = `<delnext-${uid}>`;

  const lookup = (x) => {
    let varname;
    let varvalue;
    if (token2varname.has(x)) {
      varname = token2varname.get(x).varname;
      varvalue = x;
    } else if (typeof x === "string") {
      if (x.startsWith(" ") && token2varname.has(x.substr(1))) {
        varname = token2varname.get(x.substr(1)).varname;
        varvalue = x.substr(1);
      } else if (!x.startsWith(" ") && token2varname.get(" " + x)) {
        varname = token2varname.get(" " + x).varname;
        varvalue = " " + x;
      }
    }
    return { varname, varvalue };
  };

  const getVarOut = ({ substr, varname, varvalue }) => {
    // console.log("starting getVarOut with:", { substr, varname, varvalue });
    if (substr.startsWith(" ")) {
      if (varvalue.startsWith(" ")) {
        return varname;
      } else {
        return `" "+${varname}`;
      }
    } else {
      if (varvalue.startsWith(" ")) {
        return `${varname}.trim()`;
      } else {
        return varname;
      }
    }
  };

  const unescp = (str) =>
    str.replaceAll('"', (match, offset, string) => {
      const before = string.substring(0, offset);
      // console.log({match, offset, string, before});
      if (before.endsWith(delnext)) return '"';
      else return delnext + '"';
    });

  const getExpr = (str) => {
    const { varname, varvalue } = lookup(str);
    if (varname) return getVarOut({ substr: str, varname, varvalue });
  };

  if (debug_level >= 1) console.log("starting walk");

  walk({
    data: result,
    callback: ({ data: it, mod, type: dataType }) => {
      try {
        if (debug_level >= 2) console.log("walking", { it, dataType });
        if (typeof it === "number") {
          const { varname } = lookup(it);
          if (varname) mod(delprev + varname + delnext);
        } else if (typeof it === "undefined") {
          const expr = getExpr(it);
          if (expr) mod(expr);
          else mod(delprev + "undefined" + delnext);
        } else if (typeof it === "null") {
          const expr = getExpr(it);
          if (expr) mod(expr);
          else mod(delprev + "null" + delnext);
        } else if (typeof it === "string") {
          if (["object-key-string", "object-value-string", "array-item-string"].includes(dataType)) {
            const words = separo(it, " ", { attachSep: true }).map((word) => {
              const expr = getExpr(word);
              if (expr) return { expr };
              else return { quoted: minQuote(word) };
            });
            if (words.some((word) => word.expr)) {
              let modStr = delprev;
              if (dataType === "object-key-string") modStr += "[";
              forEach(words, ({ it: word, prev, first: firstWord }) => {
                if (word.expr) {
                  if (!firstWord) modStr += "+";
                  modStr += word.expr;
                } else {
                  // current word and previous word use the same quotes
                  if (word.quoted[0] === prev?.quoted?.[0]) {
                    modStr = modStr.slice(0, -1) + word.quoted.slice(1);
                  } else {
                    // 2 strings in a row that share different quotes
                    if (!firstWord) modStr += "+";
                    modStr += word.quoted;
                  }
                }
              });
              if (dataType === "object-key-string") modStr += "]";
              modStr += delnext;
              mod(unescp(modStr));
            } else {
              mod(delprev + unescp(minQuote(it)) + delnext);
            }
          } else {
            console.log("it:", { it, dataType });
            throw new Error("unexpected dataType:", dataType);
          }
        }
      } catch (error) {
        console.error("walking error", error);
        throw error;
      }
    },
  });

  /*
    Array to hold variables created from the concatenation of other vars
    For example A=B+C
    And the order is important
  */

  const usedVarNames = new Set(varname2token.keys());
  const actual_bigram_to_varname_passes = [];
  for (let pass = 0; pass < max_passes - 1; pass++) {
    const actual_bigram_to_varname = {};
    // get an array of new varnames of all the same length (i.e. cost)
    const varnames = [];
    let varlen;
    const varNameGen = genVarNames();
    for (const varname of varNameGen) {
      if (usedVarNames.has(varname)) continue;
      if (!varlen) varlen = varname.length;
      if (varname.length !== varlen) break;
      varnames.push(varname);
    }

    // clean text ops from strings
    const bigram_count = {};

    // we already replaced numbers, nulls, and undefineds in the first pass
    // so we can just focus on strings
    forEachString(result, ({ str }) => {
      // console.log("string:", [str]);
      // remove any text operations like delprev and delnext
      str = striptags(str);

      // remove [ ... ]
      str = str.replace(/^\[/, "").replace(/\]$/, "");

      const parts = deconcat(str);
      // console.log("parts:", parts)

      const bigrams = countNGrams({ data: parts, n: 2 });

      for (let b = 0; b < bigrams.length; b++) {
        const [bigram, subcount] = bigrams[b];
        const [first, second] = bigram;

        // ignore bigrams that include a strings
        if (isQuoted(first) || isQuoted(second)) continue;

        const key = JSON.stringify(bigram);
        if (key in bigram_count) bigram_count[key][1] += subcount;
        else bigram_count[key] = [bigram, subcount];
      }
    });

    const bigram_savings = [];
    Object.values(bigram_count).forEach(([bigram, count]) => {
      // bigram is like [ 'E', 'A' ]
      const len = bigram.join("+").length;
      const current_cost = len * count;
      // declaration cost is , + variable + = + len
      const declaration_cost = 1 + varlen + 1 + len;
      const replacement_cost = declaration_cost + varlen * count;
      const savings = current_cost - replacement_cost;

      // only care if actually save space
      if (savings > 0) bigram_savings.push([bigram, savings]);
    });

    // no more opportunities to save space
    if (bigram_savings.length === 0) break;

    // sort bigram savings array from smallest to largest savings
    bigram_savings.sort((a, b) => Math.sign(a[1] - b[1]));

    // console.log("bigram_savings", bigram_savings)

    // assign bigrams to varnames
    const bigram_to_varname = {};
    for (let v = 0; v < varnames.length; v++) {
      const varname = varnames[v];
      // console.log("varname:", varname);
      const [bigram, savings] = bigram_savings.pop();
      const key = JSON.stringify(bigram);
      bigram_to_varname[key] = { bigram, varname, savings };
      if (bigram_savings.length === 0) break;
    }
    // console.log("bigram_to_varname:", bigram_to_varname);

    // walk through data and see if replacement opportunities
    forEachString(result, ({ str, mod, dataType }) => {
      const hasDelPrev = str.startsWith(delprev);
      const hasDelNext = str.endsWith(delnext);

      if (dataType === "array-item-string") {
        // converts D+' +lat=39'+u+CO into ["D", "' +lat=39'", "u", "CO"], so can be combined again with +
        const parts = deconcat(striptags(str));

        const swapped = [];

        if (parts.length === 1) {
          swapped.push(parts[0]);
        } else {
          // can only replace bigrams if have more than one gram
          for (let p = 1; p < parts.length; p++) {
            // console.log("p:", p);
            const prev = parts[p - 1];
            const curr = parts[p];
            const bigram = [prev, curr];
            // console.log("bigram;", bigram);
            const key = JSON.stringify(bigram);
            if (key in bigram_to_varname) {
              // console.log("replacing");
              const varname = bigram_to_varname[key].varname;
              swapped.push(varname);
              usedVarNames.add(varname);
              actual_bigram_to_varname[key] = { bigram, varname };
              p++; // skip checking the next bigram (because curr would be prev for that)

              // there's only one gram left, so we know that it won't be replaced
              if (p === parts.length - 1) swapped.push(parts[p]);
            } else {
              swapped.push(prev);
              if (p === parts.length - 1) swapped.push(curr);
            }
            // console.log("swapped:", swapped);
          }
        }
        // console.log("replaced", parts, "with", swapped);

        const newStr = (hasDelPrev ? delprev : "") + swapped.join("+") + (hasDelNext ? delnext : "");

        mod(unescp(newStr));
      }
    });
    // console.log(actual_bigram_to_varname);
    if (Object.keys(actual_bigram_to_varname).length > 0) {
      actual_bigram_to_varname_passes.push(actual_bigram_to_varname);
    }
  }

  let outcode = "";

  // first declare the first variable replacements
  outcode += declareVars({
    comment: "pass 1",
    vars: Array.from(varname2token.entries()).map(([name, { token }]) => {
      if (typeof token === "string") {
        return { name, value: token };
      } else if (token === null) {
        return { name, value: "null", raw: true };
      } else if (typeof token === "undefined") {
        return { name, value: "undefined", raw: true };
      } else if (typeof token === "number") {
        return { name, value: token.toString(), raw: true };
      }
    }),
  });

  actual_bigram_to_varname_passes.forEach((actual_bigram_to_varname, i) => {
    outcode += "\n\n";
    outcode += declareVars({
      comment: "pass " + (i + 2),
      vars: Object.values(actual_bigram_to_varname).map(({ bigram, varname }) => ({ name: varname, value: bigram.join("+"), raw: true })),
    });
  });

  // process the text operations
  const processedJSON = JSON.stringify(result)
    .replaceAll(new RegExp(`.${delprev}`, "g"), "")
    .replaceAll(new RegExp(`${delnext}.`, "g"), "");

  outcode += "\n";
  outcode += `${output} = ${processedJSON};`;

  return { code: outcode };
};

module.exports = { encode };

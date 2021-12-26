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
const textops = require("textops");

const hasStuff = obj => Object.keys(obj).length > 0;

const isFlatArray = it => Array.isArray(it) && it.every(subitem => subitem === null || typeof subitem !== "object");

const isQuoted = str => str.match(/^(['"`]).*\1$/);

// remove wrapping braces
const unbrace = str => str.replace(/^\[/, "").replace(/\]$/);

const forEachFlatArray = (data, cb) => {
  walk({
    data,
    callback: ({ data, mod, type }) => {
      if (isFlatArray(data)) {
        cb({ data, mod, type });
      }
    }
  });
};

const forEachString = (data, cb) => {
  walk({
    data,
    callback: ({ data, mod, type }) => {
      if (typeof data === "string") {
        cb({ str: data, mod, type });
      }
    }
  });
};

// string in code
const toString = it => {
  if (it === null) return "null";
  else if (it === undefined) return "undefined";
  else if (typeof it === "string") return it;
  else if (typeof it === "number") return it.toString();
  else if (Array.isArray(it)) return JSON.stringify(it);
  else throw new Error("to-string failed because unexpected type");
};

const encode = ({ data, debug_level = 0, language = "JavaScript", max_passes = 100, prefix, read_only = true, spacer }) => {
  if (debug_level >= 1) console.log("[encode] starting");
  if (debug_level >= 2) console.log("[encode] data:", JSON.stringify(data).substring(0, 200), "...");

  // normalizing language
  language = language.toUpperCase();
  let lang;
  if (language === "JS" || language === "JAVASCRIPT") lang = "JS";
  else if (language === "PY" || language === "PYTHON") lang = "PY";

  if (prefix == undefined) {
    if (lang === "JS") prefix = "module.exports";
    else if (lang === "PY") prefix = "data";
  }

  const useBacktick = lang === "JS";

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
  const number_counts = Object.values(counts.numbers).map(it => ({
    type: "number",
    value: it.value,
    count: it.count
  }));

  const string_counts = Object.values(counts.strings).map(it => ({
    type: "string",
    value: it.value,
    count: it.count,
    first: it.first,
    last: it.last
  }));

  const all_counts = [...number_counts, ...string_counts];
  if (counts.null) {
    all_counts.push({
      type: "null",
      value: null,
      count: counts.null
    });
  }
  if (counts.undefined) {
    all_counts.push({
      type: "undefined",
      value: undefined,
      count: counts.undefined
    });
  }

  const sorted_counts = all_counts.sort((a, b) => Math.sign(b.count - a.count));
  if (debug_level >= 1) console.log("[encode] sorted counts");
  if (debug_level >= 2) console.log("[encode] sorted_counts:", sorted_counts);

  const tokens = sorted_counts.map(it => {
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
          savings
        };
      }
    } catch (error) {
      throw error;
    }
  });
  if (debug_level >= 1) console.log(tokens);

  const skipVarNames = new Set();
  if (lang === "PY") {
    ["and", "as", "is", "or", "null"].forEach(skipword => {
      skipVarNames.add(skipword);
    });
  }

  const varname2token = new Map();
  const token2varname = new Map();

  const gen = genVarNames();
  for (const varname of gen) {
    if (debug_level >= 2) console.log("varname:", varname);
    if (skipVarNames.has(varname)) continue;

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

  const delprevchar = `<delprevchar-${uid}>`;
  const delnextchar = `<delnextchar-${uid}>`;

  // is the string an expression for an object key
  // like [a+b+c] in { [a+b+c]: value }
  const isObjKeyExprFn = ({ str, type }) => {
    return type === "object-key-string" && str.startsWith(delprevchar + "[") && str.endsWith(delnextchar + "]");
  };

  const lookup = x => {
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

  const getVarOut = ({ it, varname, varvalue }) => {
    if (typeof it === "string") {
      if (it.startsWith(" ")) {
        if (varvalue.startsWith(" ")) {
          return varname;
        } else {
          return `" "+${varname}`;
        }
      } else if (varvalue.startsWith(" ")) {
        if (lang === "JS") {
          return `${varname}.trim()`;
        } else {
          return `${varnamme}.strip()`;
        }
      }
    }
    return varname;
  };

  const unescp = str =>
    str.replaceAll('"', (match, offset, string) => {
      const before = string.substring(0, offset);
      if (before.endsWith(delnextchar)) return '"';
      else return delnextchar + '"';
    });

  const getExpr = it => {
    const { varname, varvalue } = lookup(it);
    if (varname) return getVarOut({ it, varname, varvalue });
  };

  if (debug_level >= 1) console.log("starting walk");

  // first replacement pass
  // walk through whole object and replace substring and numbers with variables
  walk({
    data: result,
    callback: ({ data: it, mod, type: dataType }) => {
      try {
        if (debug_level >= 2) console.log("walking", { it, dataType });
        if (typeof it === "number") {
          const { varname } = lookup(it);
          if (varname) mod(delprevchar + varname + delnextchar);
        } else if (typeof it === "undefined") {
          const expr = getExpr(it);
          if (expr) mod(delprevchar + expr + delnextchar);
          else mod(delprevchar + "undefined" + delnextchar);
        } else if (it === null) {
          const expr = getExpr(it);
          if (expr) mod(delprevchar + expr + delnextchar);
          else mod(delprevchar + "null" + delnextchar);
        } else if (typeof it === "string") {
          if (["object-key-string", "object-value-string", "array-item-string"].includes(dataType)) {
            const words = separo(it, " ", { attachSep: true }).map(word => {
              const expr = getExpr(word);
              if (expr) return { expr };
              else return { quoted: minQuote(word, { backtick: useBacktick }) };
            });
            if (words.some(word => word.expr)) {
              let modStr = delprevchar;
              if (dataType === "object-key-string" && lang === "JS") modStr += "[";
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
              if (dataType === "object-key-string" && lang === "JS") modStr += "]";
              modStr += delnextchar;
              mod(unescp(modStr));
            } else {
              mod(delprevchar + unescp(minQuote(it, { backtick: useBacktick })) + delnextchar);
            }
          } else {
            console.log("[json-to-code] it:", { it, dataType });
            throw new Error("unexpected dataType:", dataType);
          }
        }
      } catch (error) {
        console.error("walking error", error);
        throw error;
      }
    }
  });

  /*
    Array to hold variables created from the concatenation of other vars
    For example A=B+C
    And the order is important
  */

  const usedVarNames = new Set(varname2token.keys());
  const all_substitutions = [];
  let pass = 1; // count previous pass for unigrams
  while (pass < max_passes) {
    // holds whether anything changed
    let changed = false;

    // repeat trying to recursively compress bigrams
    // until can't save any more space
    while (pass < max_passes) {
      if (debug_level >= 1) console.log("checking bigram saving opportunities");
      // increment pass now because might break early later if no potential savings
      pass++;

      const substitutions = {};

      // get an array of new varnames of all the same length (i.e. cost)
      const varnames = [];
      let varlen;
      const varNameGen = genVarNames();
      for (const varname of varNameGen) {
        if (usedVarNames.has(varname)) continue;
        if (skipVarNames.has(varname)) continue;
        if (!varlen) varlen = varname.length;
        if (varname.length !== varlen) break;
        varnames.push(varname);
      }
      if (debug_level >= 2) console.log(`${varnames.length} possible varnames with length ${varlen}`);

      // object with
      // key: JSON of bigram array
      // value: raw number count
      const bigram_count = {};

      // we already replaced numbers, nulls, and undefineds in the first pass
      // so we can just focus on strings
      forEachString(result, leaf => {
        let { str } = leaf;

        // remove any text operations like delprevchar and delnextchar
        // assuming text ops are only at the beginning and the end
        // is that a good assumption?
        str = striptags(str);

        // remove wrapping straight braces around variable object keys
        // like going from [a+b] to a+b
        if (isObjKeyExprFn(leaf)) str = unbrace(str);

        // from a+b to array of ["a", "b"]
        const parts = deconcat(str);

        // count sequential pairs
        const bigrams = countNGrams({ data: parts, n: 2 });

        for (let b = 0; b < bigrams.length; b++) {
          const [bigram, subcount] = bigrams[b];
          const [first, second] = bigram;

          // ignore bigrams that include raw strings
          // code currently only handles bigrams made up of 2 variables
          if (isQuoted(first) || isQuoted(second)) continue;

          // convert bigram array to JSON string representation
          const key = JSON.stringify(bigram);
          if (key in bigram_count) bigram_count[key] += subcount;
          else bigram_count[key] = subcount;
        }
      });

      const bigram_savings = [];
      Object.entries(bigram_count).forEach(([bigram, count]) => {
        // convert bigram key to actual array
        const bigram_array = JSON.parse(bigram);

        // bigram is like [ 'E', 'A' ]
        // get length of E+A or 3
        const len = bigram_array.join("+").length;

        // current character count of bigrams
        const current_cost = len * count;

        // declaration cost is , + variable + = + len
        const declaration_cost = 1 + varlen + 1 + len;

        // how many bytes bigram would take up if replaced with a variable
        const replacement_cost = declaration_cost + varlen * count;

        // how many bytes we would save if we replaced a bigram with a variable
        const savings = current_cost - replacement_cost;

        // only care if actually save space
        if (savings > 0) bigram_savings.push([bigram, savings]);
      });

      // no more opportunities to save space
      // breaks out of only inner loop for bigrams
      if (bigram_savings.length === 0) break;

      // sort bigram savings array from smallest to largest savings
      bigram_savings.sort((a, b) => Math.sign(a[1] - b[1]));

      // console.log(`bigram_savings (${bigram_savings.length}) :`, bigram_savings.slice(0, 3));

      // iterate through varnames of the same length
      // assigning bigrams to the remaining names
      const bigram_to_varname = {};
      for (let v = 0; v < varnames.length; v++) {
        const varname = varnames[v];

        // pop off the last bigram which has the biggest savings
        const bigram = bigram_savings.pop()[0];

        // bigram is already JSON stringified
        bigram_to_varname[bigram] = varname;

        // no more bigrams to replace
        // seems we have more potential variable names
        // than actual replaceable bigrams
        if (bigram_savings.length === 0) break;
      }

      // walk through data and make substitutions
      forEachString(result, leaf => {
        let { str, mod, type } = leaf;

        const hasDelPrev = str.startsWith(delprevchar);
        const hasDelNext = str.endsWith(delnextchar);

        // remove text operations
        str = striptags(str);

        let isObjKeyExpr = isObjKeyExprFn(leaf);

        // remove wrapping straight braces around variable object keys
        // like going from [a+b] to a+b
        if (isObjKeyExpr) str = unbrace(str);

        // converts D+' +lat=39'+u+CO into ["D", "' +lat=39'", "u", "CO"], so can be combined again with +
        const parts = deconcat(str);

        // parts of string with variable substitution
        const swapped = [];

        let needToMod = false;
        if (parts.length === 1) {
          swapped.push(parts[0]);
        } else {
          // can only replace bigrams if have more than one gram
          for (let p = 1; p < parts.length; p++) {
            const prev = parts[p - 1];
            const curr = parts[p];
            const bigram = [prev, curr];
            const key = JSON.stringify(bigram);
            if (key in bigram_to_varname) {
              needToMod = true;
              if (type === "object-key-string") isObjKeyExpr = true;
              const varname = bigram_to_varname[key];
              swapped.push(varname);
              usedVarNames.add(varname);
              substitutions[key] = varname;
              p++; // skip checking the next bigram (because curr would be prev for that)

              // there's only one gram left, so we know that it won't be replaced
              if (p === parts.length - 1) swapped.push(parts[p]);
            } else {
              swapped.push(prev);
              if (p === parts.length - 1) swapped.push(curr);
            }
          }
        }

        const newStr = (hasDelPrev ? delprevchar : "") + (isObjKeyExpr ? "[" : "") + swapped.join("+") + (isObjKeyExpr ? "]" : "") + (hasDelNext ? delnextchar : "");

        if (needToMod) mod(unescp(newStr));
      });
      if (hasStuff(substitutions)) {
        changed = true;
        all_substitutions.push({ type: "bigram", data: substitutions });
      }
    }

    // done trying to save space via recursive bigrams,
    // so now try to find repeated arrays
    if (debug_level >= 2) console.log("checking array saving opportunities");
    while (pass < max_passes && read_only) {
      pass++;
      const substitutions = {};
      // get an array of new varnames of all the same length (i.e. cost)
      const varnames = [];
      let varlen;
      const varNameGen = genVarNames();
      for (const varname of varNameGen) {
        if (usedVarNames.has(varname)) continue;
        if (skipVarNames.has(varname)) continue;
        if (!varlen) varlen = varname.length;
        if (varname.length !== varlen) break;
        varnames.push(varname);
      }

      // read only output, so we can re-use repetitive flat arrays
      const arr_count = {};
      forEachFlatArray(result, ({ data }) => {
        let str = toString(data);

        // str includes any embedded text operations for the array

        if (arr_count[str] === undefined) arr_count[str] = 0; // initialize to zero if necessary
        arr_count[str]++;
      });

      const arr_savings = [];
      Object.entries(arr_count).forEach(([arr, count]) => {
        // run embedded text operations
        // cleans and removes <delprevchar> and <delnextchar>
        const { text } = textops.run({ text: arr, uid: Number(uid) });

        const len = text.length;
        const current_cost = len * count;

        // declaration cost is , + variable + = + len
        const declaration_cost = 1 + varlen + 1 + len;

        const replacement_cost = declaration_cost + varlen * count;
        const savings = current_cost - replacement_cost;

        // only care if actually save space
        if (savings > 0) arr_savings.push([arr, savings]);
      });

      if (arr_savings.length === 0) {
        if (debug_level >= 2) console.log("no more opportunities to save space");
        break;
      }

      // sort bigram savings array from smallest to largest savings
      arr_savings.sort((a, b) => Math.sign(a[1] - b[1]));

      const arr_to_varname = {};
      // const actual_arr_to_varname_passes = [];
      for (let v = 0; v < varnames.length; v++) {
        const varname = varnames[v];
        const [arr, savings] = arr_savings.pop();
        arr_to_varname[arr] = varname;
        if (arr_savings.length === 0) break;
      }
      if (arr_savings.length === 1) console.log({ arr_to_varname });

      forEachFlatArray(result, ({ data, mod }) => {
        const str = toString(data);
        // if array is not worth replacing
        if (str in arr_to_varname) {
          const varname = arr_to_varname[str];
          // replace array with "<delprevchar-uid>A<delnextchar-uid>"
          mod(delprevchar + varname + delnextchar);
          usedVarNames.add(varname);
          substitutions[str] = varname;
        }
      });

      if (hasStuff(substitutions)) {
        changed = true;
        all_substitutions.push({ type: "array", data: substitutions });
      }
    }

    // if couldn't find a way to compress any further, break
    if (!changed) {
      console.log(`breaking after ${pass} passes`);
      break;
    }
  }

  // console.log("all_substitutions:", all_substitutions[0]);

  let outcode = "";

  // add in null = "None"
  // for Python
  // because JSON.stringify will write in null values
  if (lang === "PY") {
    outcode += "# special handling for Python\nnull = None\nundefined = None\n";
  }

  // first declare the first variable replacements
  outcode += declareVars({
    comment: "pass 1",
    language: lang,
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
    })
  });

  all_substitutions.forEach(({ type, data }, i) => {
    outcode += "\n\n";
    outcode += declareVars({
      comment: "pass " + (i + 2) + " (" + type + ")",
      language: lang,
      vars: Object.entries(data).map(([original, varname]) => {
        const value = type === "bigram" ? JSON.parse(original).join("+") : original;
        return {
          name: varname,

          // insert value directly into declaration code
          raw: true,

          value
        };
      })
    });
  });

  // process text operations for arrays
  ({ text: outcode } = textops.run({
    ops: ["delprevchar", "delnextchar"],
    text: outcode,
    uid: Number(uid)
  }));

  if (debug_level >= 2) console.log("[json-to-code] wrote all variable declarations");
  const resultString = JSON.stringify(result, undefined, spacer);
  if (debug_level >= 2) console.log("[json-to-code] stringified result");
  const { text: processedJSON } = textops.run({
    ops: ["delprevchar", "delnextchar"],
    text: resultString,
    uid: Number(uid)
  });
  if (debug_level >= 2) console.log("[json-to-code] ran final embedded text operations");

  outcode += "\n";
  outcode += `${prefix} = ${processedJSON};`;

  return { code: outcode };
};

module.exports = { encode };

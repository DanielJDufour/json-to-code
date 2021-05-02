const walk = require("deepest-walk");

const forEachString = (data, cb) => {
  walk({
    data,
    callback: ({ data, mod, type }) => {
      if (typeof data === "string") {
        cb({ str: data, mod, dataType: type });
      }
    },
  });
};

// string in JavaScript code
const toString = (it) => {
  if (it === null) return "null";
  else if (it === undefined) return "undefined";
  else if (typeof it === "string") return it;
  else if (typeof it === "number") return it.toString();
  else throw new Error("to-string failed because unexpected type");
};

module.exports = {
  forEachString,
  toString,
};

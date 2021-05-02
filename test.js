const fs = require("fs");
const path = require("path");

const test = require("flug");

const { encode } = require("./json-to-code");

const TEST_DATA_PATH = path.resolve(__dirname, "./test-data");

const check = ({ debug_level, eq, filename, max_passes, uid }) => {
  const data = require(path.resolve(TEST_DATA_PATH, filename));
  const result = encode({ data, debug_level, max_passes });
  const outpath = path.resolve(TEST_DATA_PATH, filename.replace(".json", "-" + uid + ".tmp.js"));
  fs.writeFileSync(outpath, result.code, "utf-8");

  const decompressed = require(outpath);
  eq(decompressed, data);
};

for (let max_passes = 1; max_passes < 6; max_passes++) {
  test(`array (${max_passes} passes)`, ({ eq }) => {
    check({ eq, filename: "proj4js-definitions.json", max_passes, uid: max_passes + "-passes" });
  });
}

test("array (unlimited passes)", ({ eq }) => {
  check({ eq, filename: "proj4js-definitions.json", max_passes: Infinity });
});

for (let max_passes = 1; max_passes < 6; max_passes++) {
  test(`nested (${max_passes} passes)`, ({ eq }) => {
    check({ eq, filename: "gsa-code.json", max_passes, uid: max_passes + "-passes" });
  });
}

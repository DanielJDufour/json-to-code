const fs = require("fs");
const wktcrs = require("wkt-crs");

let data = require("./crs.json");

data = data.map(({ proj4, wkt, esriwkt }) => ({
  proj4,
  wkt: wktcrs.parse(wkt, { raw: true }).data,
  esriwkt: wktcrs.parse(esriwkt, { raw: true }).data,
}));

fs.writeFileSync("./proj.json", JSON.stringify(data, undefined, 2));
# json-to-code
JSON-to-Code Compressor: Compress JSON Data into Valid JS Code that Generates the Data

## install
```bash
npm install json-to-code
```

## basic usage
```javascript
const { encode } = require("json-to-code");

const json = {
  "agency": "GSA",
  "measurementType": {
    "method": "modules"
  },
  "version": "2.0.0",
  "releases": [
    {
      "name": "usasearch",
      "description": "System now maintained in open repo https://github.com/GSA/search-gov.",
      "permissions": {
        "licenses": null,
        "usageType": "governmentWideReuse"
      },
      "tags": [
        "GSA"
      ],
      "repositoryURL": "https://github.com/GSA/usasearch",
      "homepageURL": "https://search.gov",
      "contact": {
        "email": "gsa-github.support@gsa.gov"
      },
      "laborHours": 0,
      "vcs": "git",
      "organization": "GSA"
    }
  ]
};

const { code } = encode({
  data: json,

  // optional code to set the result to
  prefix: "module.exports = " // could be window.data = 
})
```
code will be something like
```js
/* pass 1 */
const A='gsa-github.support@gsa.gov',B='repositoryURL',C='organization',D='permissions',E='description',F='http://choosealicense.com/licenses/other/',...
module.exports = {'agency':P,'measurementType':{'method':'modules'},'version':'2.0.0','releases':[{[N]:'usasearch',[E]:HE+' now maintained in open repo https://github.com/GSA/search-gov.',[D]:{[I]:null,[H]:L},[Q]:[P],[B]:'https://github.com/GSA/usasearch',[X]:Au,[K]:{[O]:A},[G]:0,[S]:T,[C]:P},{[N]:'cron_scripts',[E]:'The ~search/scripts directory on the CRON machine, containing all'+El+' for the'+" 'search'"+' user',[D]:{[I]:null,[H]:L},[Q]:[P],[B]:'https://github.com/GSA/cron_scripts',[K]:{[O]:A},[G]:0,[S]:T,[C]:P},...
```

## advanced usage
### limiting max passes
You can specify how many times json-to-code should loop over the data looking for saving opportunities.
If speed is more important than compression quality, just set max_passes to 1.
```js
const { code } = encode({
  data: json,
  max_passes: 1
});
```

### editable
By default, encode assumes that you only want to read your data, so that it can increase compression by reusing common arrays.
However, if you will want to edit your data, set read_only to false.
```js
const { code } = encode({
  data: json,
  read_only: false
});
```

### Python
If you want to generate Python code instead of JavaScript, set language to `"Python"`.
```js
const { code } = encode({
  data: json,
  language: "Python"
});
```
Let's say you save it to a file named "thing.py".  You'll then import your data in Python like so:
```python
from thing import data
```

### Changing Prefix
If you prefer to change what variable your data is set to, you can edit the prefix.
```js
const { code } = encode({
  data: json,
  prefix: "window.data"
});
require("fs").writeFileSync("data.js", code);
```
You can then load the data in an HTML file like so:
```html
<script src="data.js"></script>
```
And access it inside a script
```js
<script>
console.log(window.data);
// console.log(data) works too if you are in the browser
</script>
```


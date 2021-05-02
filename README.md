# json-to-code
JSON-to-Code Compressor: Compress JSON Data into Valid JS Code that Generates the Data

# install
```bash
npm install json-to-code
```

# usage
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

const { code } = encode({ data: json })
```
code will be something like
```js
/* pass 1 */
const A='gsa-github.support@gsa.gov',B='repositoryURL',C='organization',D='permissions',E='description',F='http://choosealicense.com/licenses/other/',...
module.exports = {'agency':P,'measurementType':{'method':'modules'},'version':'2.0.0','releases':[{[N]:'usasearch',[E]:HE+' now maintained in open repo https://github.com/GSA/search-gov.',[D]:{[I]:null,[H]:L},[Q]:[P],[B]:'https://github.com/GSA/usasearch',[X]:Au,[K]:{[O]:A},[G]:0,[S]:T,[C]:P},{[N]:'cron_scripts',[E]:'The ~search/scripts directory on the CRON machine, containing all'+El+' for the'+" 'search'"+' user',[D]:{[I]:null,[H]:L},[Q]:[P],[B]:'https://github.com/GSA/cron_scripts',[K]:{[O]:A},[G]:0,[S]:T,[C]:P},...
```

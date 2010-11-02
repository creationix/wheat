var Step = require('step'),
    Haml = require('haml'),
    Markdown = require('./markdown'),
    MD5 = require('./md5'),
    Buffer = require('buffer').Buffer,
    Git = require('git-fs');

function pad(num, count) {
  count = count || 2;
  num = "" + num;
  for (i = num.length; i < count; i ++) num = "0" + num;
  return num;
}

// accepts the client's time zone offset from GMT in minutes as a parameter.
// returns the timezone offset in the format [+|-}DDDD
function getTZOString(timezoneOffset)
{
  var hours = Math.floor(timezoneOffset / 60);
  var modMin = Math.abs(timezoneOffset % 60);
  var s = new String();
  s += (hours > 0) ? "-" : "+";
  var absHours = Math.abs(hours);
  s += (absHours < 10) ? "0" + absHours :absHours;
  s += ((modMin == 0) ? "00" : modMin);
  return(s);
}

var daysInWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
  "Saturday", "Sunday"];
var monthsInYear = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
var aMonths = new Array("Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec");
var aDays = new Array( "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat");

var Helpers = {
  inspect: require(process.binding('natives').util ? 'util' : 'sys').inspect,
  intro: function intro(markdown) {
    var html = Markdown.encode(markdown);
    return html.substr(0, html.indexOf("<h2"));
  },
  markdownEncode: function markdownEncode(markdown) {
    return Markdown.encode(markdown+"");
  },
  github: function github(name) {
    return '<a href="http://github.com/' + name + '">' + name + '</a>';
  },
  bitbucket: function bitbucket(name) {
    return '<a href="http://bitbucket.com/' + name + '">' + name + '</a>';
  },
  twitter: function twitter(name) {
    return '<a href="http://twitter.com/' + name + '">' + name + '</a>';
  },
  gravitar: function gravitar(email, size) {
    size = size || 200;
    return "http://www.gravatar.com/avatar/" +
      MD5.md5((email+"").trim().toLowerCase()) +
      "?r=pg&s=" + size + ".jpg&d=identicon";
  },
  formatDate: function formatDate(val, format) {
    var date = new Date(val),
        match, value;
    while (match = format.match(/(%[a-z%])/i)) {
      switch (match[1]) {
        case "%Y": // A full numeric representation of a year, 4 digits
          value = date.getFullYear(); break;
        case "%m": // Numeric representation of a month, with leading zeros
          value = pad(date.getMonth() + 1); break;
        case "%F": // A full textual representation of a month like March
          value = monthsInYear[date.getMonth()]; break;
        case "%d": // Day of the month, 2 digits with leading zeros
          value = pad(date.getDate()); break;
        case "%j": // Day of the month without leading zeros
          value = date.getDate(); break;
        case "%l": // A full textual representation of the day of the week
          value = daysInWeek[date.getDay()]; break;
        case "%H": // 24-hour format of an hour with leading zeros
          value = pad(date.getHours()); break;
        case "%i": // Minutes with leading zeros
          value = pad(date.getMinutes()); break;
        case "%s": // Seconds, with leading zeros
          value = pad(date.getSeconds()); break;
        case "%u": // milliseconds with leading zeroes
          value = pad(date.getMilliseconds(), 3); break;
        case "%z": // time zone offset
          value = getTZOString(date.getTimezoneOffset()); break;
        case "%%": // literal % sign
          value = "\0%\0"; break;
        default:
          value = ""; break;
      }
      format = format.replace(match[1], value);
    }
    format = format.split("\0%\0").join("%");
    return format;
  },
  formatRFC822Date: function formatRFC822Date(val)
  {
    var oDate = new Date(val);
    var dtm = new String();

    dtm = aDays[oDate.getDay()] + ", ";
    dtm += pad(oDate.getDate()) + " ";
    dtm += aMonths[oDate.getMonth()] + " ";
    dtm += oDate.getFullYear() + " ";
    dtm += pad(oDate.getHours()) + ":";
    dtm += pad(oDate.getMinutes()) + ":";
    dtm += pad(oDate.getSeconds()) + " " ;
    dtm += getTZOString(oDate.getTimezoneOffset());
    return dtm;
  }

};

// Convert UTF8 strings to binary buffers for faster loading
function stringToBuffer(string) {
  var buffer = new Buffer(Buffer.byteLength(string));
  buffer.write(string, 'utf8');
  return buffer;
};

// Loads a haml template and caches in memory.
var loadTemplate = Git.safe(function loadTemplate(version, name, callback) {
  Step(
    function loadHaml() {
      Git.readFile(version, "skin/" + name + ".haml", this);
    },
    function compileTemplate(err, haml) {
      if (err) { callback(err); return; }
      return Haml(haml, (/\.xml$/).test(name));
    },
    callback
  );
});

// Like loadTemplate, but doesn't require the version
function compileTemplate(name, callback) {
  Step(
    function getHead() {
      Git.getHead(this);
    },
    function loadTemplates(err, version) {
      if (err) { callback(err); return; }
      loadTemplate(version, name, this);
    },
    function (err, template) {
      if (err) { callback(err); return; }
      return function (data) {
        data.__proto__ = Helpers;
        return template.apply(this, arguments);
      };
    },
    callback
  );
};

function render(name, data, callback, partial) {
  Step(
    function getHead() {
      Git.getHead(this);
    },
    function loadTemplates(err, version) {
      if (err) { callback(err); return; }
      loadTemplate(version, name, this.parallel());
      if (!partial) {
        loadTemplate(version, "layout", this.parallel());
      }
    },
    function renderTemplates(err, template, layout) {
      if (err) { callback(err); return; }
      data.__proto__ = Helpers;
      var content = template(data);
      if (partial) { return stringToBuffer(content); }
      data = {
        content: content,
        title: data.title || ""
      };
      data.__proto__ = Helpers;
      return stringToBuffer(layout(data));
    },
    callback
  )
}

module.exports = {
  stringToBuffer: stringToBuffer,
  compileTemplate: compileTemplate,
  render: render
};

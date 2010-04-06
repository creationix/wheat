var ChildProcess = require('child_process');

function Graphviz(code, options, callback) {
  if (typeof options === 'function' && typeof callback === 'undefined') {
    callback = options;
    options = {};
  }
  var child = ChildProcess.spawn(options.command || "dot", ["-T" + (options.format || 'png')]);
  var stdout = "", stderr = "";
  child.stdout.setEncoding('binary');
  child.stdout.addListener('data', function (text) {
    stdout += text;
  });
  child.stderr.addListener('data', function (text) {
    stderr += text;
  });
  child.addListener('exit', function (code) {
    if (code > 0) {
      callback(new Error(stderr));
    } else {
      callback(null, stdout);
    }
  });
  child.stdin.write(code);
  child.stdin.close();
}

module.exports = Graphviz;

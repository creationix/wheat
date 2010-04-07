/*
Copyright (c) 2010 Tim Caswell <tim@creationix.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

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

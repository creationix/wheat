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

var ChildProcess = require('child_process'),
    Buffer = require('buffer').Buffer;

function Graphviz(code, callback) {
  var child = ChildProcess.spawn("dot", ["-Tpng"]);
  var stdout = [], stderr = [], size = 0;
  child.stdout.addListener('data', function (buffer) {
    size += buffer.length;
    stdout[stdout.length] = buffer;
  });
  child.stderr.addListener('data', function (buffer) {
    stderr[stderr.length] = buffer;
  });
  child.addListener('exit', function (code) {
    child.stdout.end();
    child.stderr.end();
    if (code > 0) {
      callback(new Error(stderr.join("")));
    } else {
      var buffer = new Buffer(size);
      var start = 0;
      for (var i = 0, l = stdout.length; i < l; i++) {
        var chunk = stdout[i];
        chunk.copy(buffer, start);
        start += chunk.length;
      }
      callback(null, buffer);
    }
  });
  child.stdin.write(code);
  child.stdin.end();
}

module.exports = Graphviz;

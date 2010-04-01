// Inspired by http://github.com/willconant/flow-js
function Step() {
  var steps = Array.prototype.slice.call(arguments),
      counter, results;
  function next() {
    if (steps.length <= 0) { return; }
    var fn = steps.shift();
    counter = 0;
    results = [];
    fn.apply(next, arguments);
  }
  next.parallel = function () {
    var i = counter;
    counter++;
    return function () {
      counter--;
      results[i] = arguments;
      if (counter <= 0) {
        next(results);
      }
    }
  };
  next([]);
}
module.exports = Step;
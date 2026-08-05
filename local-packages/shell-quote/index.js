exports.quote = function(xs) { return xs.map(function(x) { return '"' + x.replace(/"/g, '\\"') + '"'; }).join(' '); };
exports.parse = function(s) { return s.match(/[^\s"]+|"[^"]*"/g) || []; };

const fs = require('fs');
const jf = require('jsonfile');
const _ = require('underscore');

let Material = module.exports = function (options) {
  options || (options = {});
  this.filename = "material.json";

  this.initialize.apply(this, arguments);
};

_.extend(Material.prototype, {
  initialize: function () {
  },

  _initFile: async function () {
    const self = this;
    return new Promise((resolve, reject) => {
      fs.exists(this.filename, function (exists) {
        if (!exists) {
          let data = {meta: {}, types: {}};
          jf.writeFile(self.filename, data, function (err) {
            if (err) {
              reject(err);
            } else {
              resolve(data);
            }
          });

        } else {
          jf.readFile(self.filename, function (err, data) {
            if (err) {
              reject(err);
            } else {
              resolve(data);
            }
          });
        }
      });
    });
  },

  getMeta: async function () {
    let data = await this._initFile();
    if (data && data.meta && _.isObject(data.meta)) {
      return data.meta;
    } else {
      return {};
    }
  },

  getTypes: async function () {
    let data = await this._initFile();
    if (data && data.types && _.isObject(data.types)) {
      return data.types;
    } else {
      return {};
    }
  }

});

// Helpers
// -------

// Helper function to correctly set up the prototype chain, for subclasses.
// Similar to `goog.inherits`, but uses a hash of prototype properties and
// class properties to be extended.
var extend = function (protoProps, staticProps) {
  var parent = this;
  var child;

  // The constructor function for the new subclass is either defined by you
  // (the "constructor" property in your `extend` definition), or defaulted
  // by us to simply call the parent's constructor.
  if (protoProps && _.has(protoProps, 'constructor')) {
    child = protoProps.constructor;
  } else {
    child = function () {
      return parent.apply(this, arguments);
    };
  }

  // Add static properties to the constructor function, if supplied.
  _.extend(child, parent, staticProps);

  // Set the prototype chain to inherit from `parent`, without calling
  // `parent`'s constructor function.
  var Surrogate = function () {
    this.constructor = child;
  };
  Surrogate.prototype = parent.prototype;
  child.prototype = new Surrogate();

  // Add prototype properties (instance properties) to the subclass,
  // if supplied.
  if (protoProps) {
    _.extend(child.prototype, protoProps);
  }

  // Set a convenience property in case the parent's prototype is needed
  // later.
  child.__super__ = parent.prototype;

  return child;
};

Material.extend = extend;

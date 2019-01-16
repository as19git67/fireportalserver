const fs = require('fs');
const jf = require('jsonfile');
const _ = require('underscore');
const moment = require('moment');
const speakeasy = require('speakeasy');

let Users = module.exports = function () {
  this.filename = "users.json";

  this.initialize.apply(this, arguments);
};

_.extend(Users.prototype, {
  initialize: function () {
  },

  _initFile: function (callback) {
    const self = this;
    fs.exists(this.filename, function (exists) {
      if (!exists) {
        let data = {users: {}};
        jf.writeFile(self.filename, data, function (err) {
          if (err) {
            throw new Error(err);
          }
          callback(data);
        });
      } else {
        jf.readFile(self.filename, function (err, data) {
          if (err) {
            throw new Error(err);
          }
          callback(data);
        });
      }
    });
  },

  createUser: function (username, email, callback) {
    const self = this;
    this.getUserByName(username, function (err, existingUser) {
      if (err) {
        callback(err);
      } else {
        if (existingUser) {
          callback("Can't create user " + username + ", because it already exists");
        } else {
          let secret = speakeasy.generateSecret();
          self._addJob(username, email, secret.base32, function (err, user) {
            callback(err, user);
          });
        }
      }
    });
  },

  checkPassword: function (user, password) {
    return false;
  },

  getUserByEmail: function (email, options, callback) {
    options || (options = {});
    const self = this;
    this._initFile(function (data) {
      let user = _.findWhere(data.users, {email: email});
      if (user) {
        callback(null, {
          username: user.username,
          email: user.email,
          state: user.state,
          canRead: user.canRead,
          isAdmin: user.isAdmin,
          otpCounter: user.otpCounter
        });
      } else {
        console.log("User with email ", email, " does not exist.");
        callback();
      }
    });
  },

  getUserByName: function (name, callback) {
    const self = this;
    this._initFile(function (data) {
      const user = data.users[name];
      if (user) {
        callback(null, {
          name: user.name,
          email: user.email,
          state: user.state,
          canRead: user.canRead,
          isAdmin: user.isAdmin,
          otpCounter: user.otpCounter
        });
      } else {
        callback(null, null);
      }
    });
  },

  getAll: function (callback) {
    const self = this;
    this._initFile(function (data) {
      if (data) {
        callback(null, _.map(data.users, function (user) {
          return {
            name: user.name,
            email: user.email,
            state: user.state,
            canRead: user.canRead,
            isAdmin: user.isAdmin,
            otpCounter: user.otpCounter
          };
        }));
      } else {
        callback(null, []);
      }
    });
  },

  _addJob: function (name, email, secret, callback) {
    const self = this;
    this._initFile(function (data) {
      if (data.users[name]) {
        callback("Can't add existing user");
      } else {
        let user = {
          name: name,
          email: email,
          secret: secret,
          otpCounter: 0,
          state: 'new',
          canRead: false,
          isAdmin: false
        };
        data.users[user.name] = user;
        jf.writeFile(self.filename, data, function (err) {
          if (err) {
            callback(err);
          } else {
            callback(null, user);
          }
        });
      }
    });
  },

  /* updates user information - without secret and otpCounter */
  saveUser: function (user, callback) {
    if (!user.name) {
      const err = "ERROR: attempt to save incomplete user";
      console.log(err);
      callback(err);
      return;
    }
    const self = this;
    this._initFile(function (data) {
      if (data.users[user.name]) {
        _.extend(data.users[user.name],
            _.pick(user, 'name', 'email', 'otpCounter', 'canRead', 'isAdmin'));
        jf.writeFile(self.filename, data, function (error) {
          if (error) {
            callback(error);
          } else {
            callback(null);
          }
        });
      } else {
        callback("User does not exist")
      }
    });
  },

  deleteUser: function (name, callback) {
    if (!name) {
      const err = "ERROR: attempt to delete user with undefined name";
      console.log(err);
      callback(err);
      return;
    }
    const self = this;
    this._initFile(function (data) {
      delete data.users[name];
      jf.writeFile(self.filename, data, function (error) {
        if (error) {
          callback(error);
        } else {
          callback(null);
        }
      });
    });
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

Users.extend = extend;

const fs = require('fs');
const jf = require('jsonfile');
const _ = require('underscore');
const moment = require('moment');
const speakeasy = require('speakeasy');
const hat = require('hat');

let Users = module.exports = function (options) {
  options || (options = {});
  this.tokenLifetimeInMinutes = options.tokenLifetimeInMinutes ? options.tokenLifetimeInMinutes : 60;
  this.filename = "users.json";

  this.initialize.apply(this, arguments);
};

_.extend(Users.prototype, {
  initialize: function () {
  },

  _initFile: function () {
    const self = this;
    return new Promise((resolve, reject) => {
      fs.exists(this.filename, function (exists) {
        if (!exists) {
          let data = {users: {}};
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
              resolve(data)
            }
          });
        }
      });
    });
  },

  createUser: async function (username, email) {
    const self = this;
    let existingUser = await this.getUserByName(username);
    if (existingUser) {
      if (existingUser.state === "new") {
        await self.deleteUser(existingUser.name)
      } else {
        throw new Error("Can't create user " + username + ", because it already exists");
      }
    }
    let secret = speakeasy.generateSecret();
    let user = await self._addUser(username, email, secret.base32, moment().add(1, 'week'));
    return user;
  },

  getUserByEmail: async function (email, options) {
    options || (options = {});
    let data = await this._initFile();
    let user = _.findWhere(data.users, {email: email});
    if (user) {
      return {
        username: user.username,
        email: user.email,
        state: user.state,
        canRead: user.canRead,
        isAdmin: user.isAdmin
      };
    } else {
      console.log("User with email ", email, " does not exist.");
    }
  },

  getUserByName: async function (name) {
    let data = await this._initFile();
    const user = data.users[name];
    if (user) {
      return {
        name: user.name,
        email: user.email,
        state: user.state,
        canRead: user.canRead,
        isAdmin: user.isAdmin
      };
    }
  },

  getUserSecretByName: async function (name, issuer) {
    let data = await this._initFile();
    const user = data.users[name];
    if (user) {
      const otpauthURL = speakeasy.otpauthURL({secret: user.secret, encoding: 'base32', label: user.email, issuer: issuer});
      return {
        secret: user.secret,
        otpauthURL: otpauthURL
      };
    }
  },

  verifyCode: async function (name, code) {
    let data = await this._initFile();
    const user = data.users[name];
    if (user) {
      let tokenValidates = speakeasy.totp.verify({
        secret: user.secret,
        encoding: 'base32',
        token: code,
        window: 6
      });

      if (process.env.NODE_ENV === 'development' && code === '000000') {
        console.log("WARNING: token validation bypassed for debugging");
        return true;
      }

      if (tokenValidates) {
        return true;
      } else {
        throw new Error('Code verification failed')
      }
    } else {
      throw new Error('Unknown user');
    }
  },

  verifyCodeAndCreateAccessTokenForUser: async function (name, code) {

    let codeOk = await this.verifyCode(name, code);
    if (codeOk) {
      const tokenValue = hat().toString('base64');
      const tokenData = {
        accessToken: tokenValue,
        accessTokenExpiresAfter: moment().add(this.tokenLifetimeInMinutes, 'minutes')
      };

      const self = this;
      let data = await this._initFile();
      let user = data.users[name];
      if (user) {
        _.extend(user, {accessToken: tokenData.accessToken, accessTokenExpiresAfter: tokenData.accessTokenExpiresAfter});
        return new Promise((resolve, reject) => {
          jf.writeFile(self.filename, data, function (error) {
            if (error) {
              reject(error);
            } else {
              tokenData.accessRights = [];
              if (user.isAdmin) {
                tokenData.accessRights.push('admin');
                tokenData.accessRights.push('read');
              } else {
                if (user.canRead) {
                  tokenData.accessRights.push('read');
                }
              }
              resolve(tokenData);
            }
          });
        });
      } else {
        throw new Error("User does not exist");
      }
    }
  },

  getAll: async function () {
    let data = await this._initFile();
    if (data) {
      let notExpiredUsers = _.filter(data.users, function (user) {
        if (!user.expiredAfter) {
          user.expiredAfter = "9999-12-31";
          return true;
        } else {
          let ea = moment(user.expiredAfter);
          return moment().isBefore(ea)
        }
      });
      return _.map(notExpiredUsers, function (user) {
        return {
          name: user.name,
          email: user.email,
          state: user.state,
          canRead: user.canRead,
          isAdmin: user.isAdmin,
          expiredAfter: user.expiredAfter
        };
      });
    } else {
      return [];
    }
  },

  _addUser: async function (name, email, secret, expiredAfter) {
    const self = this;
    let data = await this._initFile();
    if (data.users[name]) {
      throw new Error("Can't add existing user");
    } else {
      let user = {
        name: name,
        email: email,
        secret: secret,
        state: 'new',
        canRead: false,
        isAdmin: false,
        expiredAfter: expiredAfter
      };
      data.users[user.name] = user;
      return new Promise((resolve, reject) => {
        jf.writeFile(self.filename, data, function (error) {
          if (error) {
            reject(error);
          } else {
            resolve(user);
          }
        });
      });
    }
  },

  /* updates user information - without secret and otpCounter */
  saveUser: async function (user) {
    if (!user.name) {
      const err = "ERROR: attempt to save incomplete user";
      console.log(err);
      throw new Error(err);
    }
    const self = this;
    let data = await this._initFile();
    if (data.users[user.name]) {
      _.extend(data.users[user.name], _.pick(user, 'name', 'email', 'state', 'canRead', 'isAdmin', 'expiredAfter'));
      return new Promise((resolve, reject) => {
        jf.writeFile(self.filename, data, function (error) {
          if (error) {
            reject(error);
          } else {
            let savedUser = data.users[user.name];
            resolve({
              name: savedUser.name,
              email: savedUser.email,
              state: savedUser.state,
              canRead: savedUser.canRead,
              isAdmin: savedUser.isAdmin,
              expiredAfter: savedUser.expiredAfter
            });
          }
        });
      });
    } else {
      throw new Error("User does not exist")
    }
  },

  deleteUser: async function (name) {
    if (!name) {
      const err = "ERROR: attempt to delete user with undefined name";
      throw new Error(err);
    }
    const self = this;
    let data = await this._initFile();
    delete data.users[name];
    return new Promise((resolve, reject) => {
      jf.writeFile(self.filename, data, function (error) {
        if (error) {
          reject(error);
        } else {
          resolve();
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

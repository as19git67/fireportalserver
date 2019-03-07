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
          jf.writeFile(self.filename, data, {spaces: 2}, function (err) {
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
    if (username === 'undefined' || !username) {
      throw new Error('username undefined');
    }
    const self = this;
    let existingUser = await this.getUserByName(username);
    if (existingUser) {
      if (existingUser.state === "new") {
        await self.deleteUser(existingUser.name)
      } else {
        throw new Error("Can't create user " + username + ", because it already exists");
      }
    }
    // generate accessToken already at this state to be able to use it in the confirmation URL
    const tokenData = {
      accessToken: hat().toString('base64'),
      accessTokenExpiresAfter: moment().add(2, 'days')
    };
    // secretData is for totp code based authentication
    const secretData = {
      secret: speakeasy.generateSecret().base32,
      expiredAfter: tokenData.accessTokenExpiresAfter
    };
    let user = await self._addUser(username, email, secretData, tokenData);
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
        canWrite: user.canWrite,
        isAdmin: user.isAdmin,
        isAutologin: user.isAutologin,
        encryptionKeyName: user.encryptionKeyName
      };
    } else {
      console.log("User with email ", email, " does not exist.");
    }
  },

  getUserByName: async function (name) {
    if (name === 'undefined') {
      throw new Error('undefined name');
    }
    let data = await this._initFile();
    const user = data.users[name];
    if (user) {
      return {
        name: user.name,
        email: user.email,
        state: user.state,
        canRead: user.canRead,
        canWrite: user.canWrite,
        isAdmin: user.isAdmin,
        isAutologin: user.isAutologin,
        encryptionKeyName: user.encryptionKeyName
      };
    }
  },

  getUserSecretByName: async function (name, issuer) {
    if (name === 'undefined') {
      throw new Error('undefined name');
    }
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
    if (name === 'undefined' || !name) {
      throw new Error('undefined name');
    }
    let data = await this._initFile();
    const user = data.users[name];
    if (user) {
      return new Promise((resolve, reject) => {
        let tokenValidates = speakeasy.totp.verify({
          secret: user.secret,
          encoding: 'base32',
          token: code,
          window: 6
        });

        if (process.env.NODE_ENV === 'development' && code === '000000') {
          console.log("WARNING: token validation bypassed for debugging");
          resolve(true);
          return;
        }

        setTimeout(function () {
          if (tokenValidates) {
            resolve(true);
          } else {
            reject('Code verification failed');
          }
        }, 2 * 1000);
      });
    } else {
      throw new Error('Unknown user');
    }
  },

  verifyCodeAndCreateAccessTokenForUser: async function (name, code) {
    if (name === 'undefined' || !name) {
      throw new Error('undefined name');
    }

    let codeOk = await this.verifyCode(name, code);
    if (codeOk) {
      const tokenValue = hat().toString('base64');
      const self = this;
      let data = await this._initFile();
      let user = data.users[name];
      if (user) {
        const tokenData = {
          accessToken: tokenValue
        };
        if (user.isAutologin) {
          tokenData.accessTokenExpiresAfter = moment("9999-12-31");
          tokenData.isAutologin = true
        } else {
          tokenData.accessTokenExpiresAfter = moment().add(this.tokenLifetimeInMinutes, 'minutes')
        }
        _.extend(user, {accessToken: tokenData.accessToken, accessTokenExpiresAfter: tokenData.accessTokenExpiresAfter});
        return new Promise((resolve, reject) => {
          jf.writeFile(self.filename, data, {spaces: 2}, function (error) {
            if (error) {
              reject(error);
            } else {
              tokenData.accessRights = self.getAccessRights(user);
              resolve(tokenData);
            }
          });
        });
      } else {
        throw new Error("User does not exist");
      }
    }
  },

  verifyTokenAndGetUser: async function (name, token, newToo) {
    let data = await this._initFile();
    if (name === 'undefined' || !name) {
      throw {message: 'undefined name', status: 401};
    }
    if (!token) {
      throw {message: 'invalid access token', status: 401};
    }
    let user = data.users[name];
    if (user) {
      if (newToo || user.state === 'provisioned') {
        if (user.accessToken === token) {
          let now = moment();
          if (now.isAfter(user.accessTokenExpiresAfter)) {
            throw {message: 'access token expired', status: 401};
          } else {
            return _.pick(user, 'name', 'email', 'state', 'canRead', 'canWrite', 'isAdmin', 'expiredAfter', 'encryptionKeyName');
          }
        } else {
          throw {message: 'invalid access token', status: 401};
        }
      } else {
        throw {message: 'user is not provisioned', status: 401};
      }
    } else {
      throw new {message: "user does not exist", status: 401};
    }
  },

  getAccessRights: function (user) {
    let accessRights = [];
    if (user.isAdmin) {
      accessRights.push('admin');
      accessRights.push('read');
      accessRights.push('write');
      if (user.encryptionKeyName) {
        accessRights.push('decrypt');
      }
    } else {
      if (user.canRead) {
        accessRights.push('read');
      }
      if (user.canWrite) {
        accessRights.push('write');
      }
      if (user.encryptionKeyName) {
        accessRights.push('decrypt');
      }
    }
    return accessRights;
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
          canWrite: user.canWrite,
          isAdmin: user.isAdmin,
          isAutologin: user.isAutologin,
          expiredAfter: user.expiredAfter,
          encryptionKeyName: user.encryptionKeyName
        };
      });
    } else {
      return [];
    }
  },

  _addUser: async function (name, email, secretData, tokenData) {
    const self = this;
    if (name === 'undefined' || !name) {
      throw new Error('undefined name');
    }
    let data = await this._initFile();
    if (data.users[name]) {
      throw new Error("Can't add existing user");
    } else {
      let user = {
        name: name,
        email: email,
        secret: secretData.secret,
        state: 'new',
        canRead: false,
        canWrite: false,
        isAdmin: false,
        isAutologin: false,
        expiredAfter: secretData.expiredAfter,
        accessToken: tokenData.accessToken,
        accessTokenExpiresAfter: tokenData.accessTokenExpiresAfter
      };
      data.users[user.name] = user;
      return new Promise((resolve, reject) => {
        jf.writeFile(self.filename, data, {spaces: 2}, function (error) {
          if (error) {
            reject(error);
          } else {
            resolve(user);
          }
        });
      });
    }
  },

  setPrivateKey: async function (username, encryptedPrivateKey, salt, encryptionKeyName) {
    // todo lock users.json file during read and write for consistency
    let user = await this.getUserByName(username);
    if (!user) {
      throw new Error(`User ${username} does not exist`);
    }
    user.encryptedPrivateKey = encryptedPrivateKey;
    user.encryptionPrivateKeySalt = salt;
    user.encryptionKeyName = encryptionKeyName;
    let savedUser = await this.saveUser(user);
    return savedUser.encryptionKeyName;
  },

  encryptData: async function (data, username, password) {

  },

  /* updates user information - without secret and otpCounter */
  saveUser: async function (user) {
    if (!user) {
      throw new Error('undefined user');
    }
    if (!user.name) {
      const err = "ERROR: attempt to save incomplete user";
      console.log(err);
      throw new Error(err);
    }
    const self = this;
    let data = await this._initFile();
    if (data.users[user.name]) {
      _.extend(data.users[user.name],
          _.pick(user, 'name', 'email', 'state', 'canRead', 'canWrite', 'isAdmin', 'isAutologin', 'expiredAfter', 'encryptedPrivateKey',
              'encryptionPrivateKeySalt', 'encryptionKeyName'));
      return new Promise((resolve, reject) => {
        jf.writeFile(self.filename, data, {spaces: 2}, function (error) {
          if (error) {
            reject(error);
          } else {
            let savedUser = data.users[user.name];
            resolve({
              name: savedUser.name,
              email: savedUser.email,
              state: savedUser.state,
              canRead: savedUser.canRead,
              canWrite: savedUser.canWrite,
              isAdmin: savedUser.isAdmin,
              isAutologin: savedUser.isAutologin,
              expiredAfter: savedUser.expiredAfter,
              encryptionKeyName: savedUser.encryptionKeyName
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
    let user = data.users[name];
    if (user.isAdmin) {
      let otherAdmin = _.find(data.users, function (u) {
        return u.isAdmin && u.name !== user.name;
      });
      if (!otherAdmin) {
        throw new Error("Can't delete last administrator");
      }
    }
    if (user.encryptionKeyName) {
      let otherUserCanDecrypt = _.find(data.users, function (u) {
        return u.encryptionKeyName && u.name !== user.name;
      });
      if (!otherUserCanDecrypt) {
        throw new Error("Can't delete last user that can decrypt");
      }
    }
    delete data.users[name];
    return new Promise((resolve, reject) => {
      jf.writeFile(self.filename, data, {spaces: 2}, function (error) {
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

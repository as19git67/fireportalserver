const fs = require('fs');
const jf = require('jsonfile');
const _ = require('underscore');
const moment = require('moment');
const speakeasy = require('speakeasy');
const hat = require('hat');
const crypto = require('crypto');
const config = require('./config');
const forge = require('node-forge');

const usersDataFilename = 'users.json';
fs.unlink('locked_' + usersDataFilename, (err) => {
  if (err) {
    console.error(err);
  }
});

let Users = module.exports = function (options) {
  options || (options = {});
  this.tokenLifetimeInMinutes = options.tokenLifetimeInMinutes ? options.tokenLifetimeInMinutes : 6;
  // minimum token lifetime is 6 minutes
  if (this.tokenLifetimeInMinutes < 6) {
    this.tokenLifetimeInMinutes = 6
  }

  this.filename = usersDataFilename;
  this.initialize.apply(this, arguments);
};

_.extend(Users.prototype, {
  initialize: function () {
  },

  // the lock function must be a recursive timer
  _flock: function (resolve, reject) {
    const self = this;
    fs.symlink(this.filename, 'locked_' + this.filename, (err) => {
      if (err) {
        if (err.code === 'EEXIST') {
          setTimeout(() => {
            self._flock(resolve, reject)
          }, 50);
        } else {
          reject(err);
        }
      } else {
        resolve();
      }
    });
  },

  _funlock: function () {
    // Unlock file
    fs.unlink('locked_' + this.filename, (err) => {
      if (err) {
        console.error(err);
      }
    });
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
          new Promise((resolve, reject) => {
            self._flock(resolve, reject);
          })
              .then(() => {
                jf.readFile(self.filename, function (err, data) {
                  if (err) {
                    reject(err);
                  } else {
                    resolve(data)
                  }
                });
              })
              .catch(reason => {
                reject(reason);
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
    this._funlock();
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
    this._funlock();
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
    this._funlock();
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
    this._funlock();
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

    try {
      let codeOk = await this.verifyCode(name, code);
      if (codeOk) {
        const tokenValue = hat().toString('base64');
        const self = this;
        let data = await this._initFile();
        let user = data.users[name];
        if (user) {
          let tokenData = {
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
                tokenData.encryptionKeyName = user.encryptionKeyName;
                resolve(tokenData);
              }
            });
          });
        } else {
          throw new Error("User does not exist");
        }
      }
    } finally {
      this._funlock();
    }
  },

  refreshToken: async function (name) {
    const self = this;
    try {
      let data = await this._initFile();
      if (name === 'undefined' || !name) {
        throw {message: 'undefined name', status: 401};
      }
      let user = data.users[name];
      if (user) {
        let now = moment();
        if (now.isAfter(user.expiredAfter)) {
          throw {message: 'user expired', status: 401};
        } else {
          if (user.state === 'provisioned') {
            const tokenValue = hat().toString('base64');
            let tokenData = {
              refreshAccessToken: tokenValue
            };
            if (user.isAutologin) {
              tokenData.refreshAccessTokenExpiresAfter = moment("9999-12-31");
            } else {
              tokenData.refreshAccessTokenExpiresAfter = moment().add(this.tokenLifetimeInMinutes, 'minutes')
            }
            _.extend(user, {refreshAccessToken: tokenData.refreshAccessToken, refreshAccessTokenExpiresAfter: tokenData.refreshAccessTokenExpiresAfter});
            return new Promise((resolve, reject) => {
              jf.writeFile(self.filename, data, {spaces: 2}, function (error) {
                if (error) {
                  reject(error);
                } else {
                  resolve(tokenData);
                }
              });
            });
          } else {
            throw {message: 'user is not provisioned', status: 401};
          }
        }
      } else {
        throw new {message: "user does not exist", status: 401};
      }
    } finally {
      this._funlock();
    }
  },

  verifyTokenAndGetUser: async function (name, token, newToo) {
    const self = this;
    try {
      let data = await this._initFile();
      if (name === 'undefined' || !name) {
        throw {message: 'undefined name', status: 401};
      }
      if (!token) {
        throw {message: 'invalid access token', status: 401};
      }
      let user = data.users[name];
      if (user) {
        let now = moment();
        if (now.isAfter(user.expiredAfter)) {
          throw {message: 'user expired', status: 401};
        } else {
          if (newToo || user.state === 'provisioned') {
            if (user.refreshAccessToken === token) {
              console.log("Checking refresh token");
              user.accessToken = user.refreshAccessToken;
              delete user.refreshAccessToken;
              user.accessTokenExpiresAfter = user.refreshAccessTokenExpiresAfter;
              delete user.refreshAccessTokenExpiresAfter;
              await new Promise((resolve, reject) => {
                jf.writeFile(self.filename, data, {spaces: 2}, function (error) {
                  if (error) {
                    reject(error);
                  } else {
                    resolve();
                  }
                });
              });
            }
            if (user.accessToken === token) {
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
        }
      } else {
        throw new {message: "user does not exist", status: 401};
      }
    } finally {
      this._funlock();
    }
  },

  getAccessRights: function (user) {
    const publicKeyName = config.get('encryptionKeyName');
    let accessRights = [];
    if (user.isAdmin) {
      accessRights.push('admin');
      accessRights.push('read');
      accessRights.push('write');
      if (user.encryptionKeyName) {
        accessRights.push('decrypt');
      }
      if (publicKeyName) {
        accessRights.push('encrypt');
      }
    } else {
      if (user.canRead) {
        accessRights.push('read');
      }
      if (user.canWrite) {
        accessRights.push('write');

        // encrypt must have right to write and public key must be configured
        if (publicKeyName) {
          accessRights.push('encrypt');
        }
      }
      if (user.encryptionKeyName) {
        accessRights.push('decrypt');
      }
    }
    return accessRights;
  },

  getAll: async function () {
    try {
      let data = await this._initFile();
      if (data) {
        // let notExpiredUsers = _.filter(data.users, function (user) {
        //   if (!user.expiredAfter) {
        //     user.expiredAfter = "9999-12-31";
        //     return true;
        //   } else {
        //     let ea = moment(user.expiredAfter);
        //     return moment().isBefore(ea)
        //   }
        // });
        return _.map(data.users, function (user) {
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
    } finally {
      this._funlock();
    }
  },

  _addUser: async function (name, email, secretData, tokenData) {
    const self = this;
    if (name === 'undefined' || !name) {
      throw new Error('undefined name');
    }
    try {
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
    } finally {
      this._funlock();
    }
  },

  // create key from password with salt
  _createHashPassword: function (password, salt) {
    const d1 = new Date();
    let passwordHash = crypto.pbkdf2Sync(Buffer.from(password), Buffer.from(salt), 2000000, 32, 'sha512');
    const d2 = new Date();
    console.log(d1.toString() + ', ' + d2.toString());
    return passwordHash.toString('base64');
  },

  createNewKeyPair: async function (username, password) {
    let user = await this.getUserByName(username);
    if (user) {
      return new Promise((resolve, reject) => {

        // create random salt
        const salt = crypto.randomBytes(32).toString('base64');

        const pwHash = this._createHashPassword(password, salt);

        // create new RSA keypair
        crypto.generateKeyPair('rsa', {
          modulusLength: 4096,
          publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
          },
          privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem',
            cipher: 'aes-256-cbc',
            passphrase: pwHash
          }
        }, async (err, publicKey, privateKey) => {
          if (err) {
            reject(err);
            return;
          }

          // // create new AES256 encryption key
          // const aesKeyAsBase64 = crypto.randomBytes(32).toString('base64');
          // // encrypt the encryption key with pwHash
          // const aesKeySecured = _encrypt(aesKeyAsBase64, pwHash, iv);

          const keyName = `${username}-${moment().format()}`;

          // todo lock users.json file during read and write for consistency
          user.encryptedPrivateKey = privateKey;
          user.encryptionPrivateKeySalt = salt;
          user.encryptionKeyName = keyName;
          let savedUser = await this.saveUser(user);
          resolve({encryptionKeyName: savedUser.encryptionKeyName, encryptionPublicKey: publicKey});
        });
      });
    } else {
      throw new Error(`User ${username} does not exist`);
    }
  }
  ,

  getPrivateKey: async function (username, password) {
    if (!password) {
      throw new Error("Can't get private key without password");
    }
    try {
      let data = await this._initFile();
      const user = data.users[username];
      if (user) {
        let salt = user.encryptionPrivateKeySalt;
        let privateKey = user.encryptedPrivateKey;
        if (salt && privateKey) {
          const pwHash = this._createHashPassword(password, salt);
          return {encryptedPrivateKey: privateKey, passphrase: pwHash, encryptionKeyName: user.encryptionKeyName};
        } else {
          throw new Error(`User ${username} has no decryption key`);
        }
      } else {
        throw new Error(`Unknown user ${username}`);
      }
    } finally {
      this._funlock();
    }
  },

  migratePrivateKey: async function (sourceUsername, sourcePrivateKeyPassword, sourceKeyname, targetUsername, targetPrivateKeyPassword) {
    if (!sourcePrivateKeyPassword) {
      throw new Error("Can't get source private key without password");
    }
    if (!targetPrivateKeyPassword) {
      throw new Error("Can't save target private key without password");
    }
    try {
      let data = await this._initFile();
      const sourceUser = data.users[sourceUsername];
      if (sourceUser) {
        const targetUser = data.users[targetUsername];
        if (targetUser) {
          if (targetUser.encryptionKeyName) {
            throw new Error(`User ${username} already has a decryption key (${targetUser.encryptionKeyName}) set`)
          }
          if (sourceUser.encryptionKeyName === sourceKeyname) {
            let salt = sourceUser.encryptionPrivateKeySalt;
            if (salt && sourceUser.encryptedPrivateKey) {
              const sourcePasswordHash = this._createHashPassword(sourcePrivateKeyPassword, salt);

              const pki = forge.pki;
              let sourceKeyBuffer = Buffer.from(sourceUser.encryptedPrivateKey);
              const privateKey = pki.decryptRsaPrivateKey(sourceKeyBuffer, sourcePasswordHash);
              if (privateKey) {
                // create random salt for target user
                salt = crypto.randomBytes(32).toString('base64');
                const targetPasswordHash = this._createHashPassword(targetPrivateKeyPassword, salt);
                const targetPrivateKeyAsPem = pki.encryptRsaPrivateKey(privateKey, targetPasswordHash);
                targetUser.encryptedPrivateKey = targetPrivateKeyAsPem;
                targetUser.encryptionPrivateKeySalt = salt;
                targetUser.encryptionKeyName = sourceUser.encryptionKeyName;
                let savedUser = await this.saveUser(targetUser);
                return {encryptionKeyName: savedUser.encryptionKeyName};
              } else {
                throw new Error(`Password for key ${sourceUser.encryptionKeyName} is wrong.`)
              }
            } else {
              throw new Error(`User ${sourceUsername} has no decryption key`);
            }
          } else {
            throw new Error(`User ${sourceUsername} does not have private key ${sourceUser.encryptionKeyName}`);
          }
        } else {
          throw new Error(`Unknown target user ${targetUsername}`);
        }
      } else {
        throw new Error(`Unknown source user ${sourceUsername}`);
      }
    } finally {
      this._funlock();
    }
  },

  deletePrivateKey: async function (username, encryptionKeyName) {
    try {
      let data = await this._initFile();
      const user = data.users[username];
      if (!user) {
        throw new Error(`User ${username} does not exist`);
      }
      if (user.encryptionKeyName !== encryptionKeyName) {
        throw new Error(`User ${username} does not have decryptionKeyName ${encryptionKeyName}`);
      }

      user.encryptionKeyName = '';
      user.encryptedPrivateKey = '';
      user.encryptionPrivateKeySalt = '';

      await this.saveUser(user);
      return await this.getUserByName(username);
    } finally {
      this._funlock();
    }
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
    try {
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
    } finally {
      this._funlock();
    }
  },

  deleteUser: async function (name) {
    if (!name) {
      const err = "ERROR: attempt to delete user with undefined name";
      throw new Error(err);
    }
    const self = this;
    try {
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
    } finally {
      this._funlock();
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

Users.extend = extend;

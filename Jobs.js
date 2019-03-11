const fs = require('fs');
const path = require('path');
const jf = require('jsonfile');
const _ = require('underscore');
const moment = require('moment');
const config = require('./config');
const crypto = require('crypto');

let Jobs = module.exports = function () {
  this.filename = "jobs.json";

  this.initialize.apply(this, arguments);
};

_.extend(Jobs.prototype, {
  initialize: function () {
  },

  _initFile: async function () {
    const self = this;
    return new Promise((resolve, reject) => {
      fs.exists(this.filename, function (exists) {
        if (!exists) {
          let data = {jobs: {}, sequence: 0};
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

  addJob: async function (job) {
    if (job) {
      let addedJob = await this._addJob(job);
      return addedJob;
    } else {
      throw new Error("job is undefined");
    }
  },

  getJobById: async function (id) {
    let data = await this._initFile();
    const job = data.jobs[id];
    if (job) {
      let jobData = _.pick(job, 'id', 'encrypted', 'encryptedRandomBase64', 'encryptionRandomIvBase64', 'encryptedData', 'start', 'end', 'title',
          'number', 'keyword', 'catchword', 'longitude', 'latitude', 'street', 'streetnumber', 'city', 'object', 'resource', 'plan', 'images',
          'attendees', 'report');
      jobData.id = id;
      return jobData;
    }
  },

  /* return all jobs as array, sorted by start */
  getAll: async function () {
    let data = await this._initFile();
    if (data) {
      let jobs = _.map(data.jobs, function (job, key) {
        let oneJob = _.pick(job, 'encrypted', 'encryptedRandomBase64', 'encryptionRandomIvBase64', 'encryptedData', 'start', 'end', 'title',
            'number', 'keyword', 'catchword', 'longitude', 'latitude', 'street', 'streetnumber', 'city', 'object', 'resource', 'plan', 'images',
            'attendees', 'report');
        oneJob.id = key;
        return oneJob;
      });
      return _.sortBy(jobs, 'start');
    } else {
      return [];
    }
  },

  _addJob: async function (encrypted, start, end, title, number, keyword, catchword, longitude, latitude, street, streetnumber, city, object,
      resource, plan,
      images,
      attendees) {
    let data = await this._initFile();
    const id = data.sequence;
    data.sequence++;
    let job;

    if (_.isObject(encrypted)) {
      let o = encrypted;
      job = {
        encrypted: o.encrypted,
        start: o.start,
        end: o.end,
        title: o.title,
        number: o.number,
        keyword: o.keyword,
        catchword: o.catchword,
        longitude: o.longitude,
        latitude: o.latitude,
        street: o.street,
        streetnumber: o.streetnumber,
        city: o.city,
        object: o.object,
        resource: o.resource,
        plan: o.plan,
        images: o.images,
        attendees: o.attendees
      };
    } else {
      job = {
        encrypted: encrypted,
        start: start,
        end: end,
        title: title,
        number: number,
        keyword: keyword,
        catchword: catchword,
        longitude: longitude,
        latitude: latitude,
        street: street,
        streetnumber: streetnumber,
        city: city,
        object: object,
        resource: resource,
        plan: plan,
        images: images,
        attendees: attendees
      };
    }
    data.jobs[id] = job;

    return new Promise((resolve, reject) => {
      jf.writeFile(this.filename, data, {spaces: 2})
          .then(() => {
            resolve(job);
          })
          .catch(reason => {
            reject(reason);
          });
    });
  },

  backupJobs: function () {
    const filename = path.join(__dirname, `jobs.backup.${moment().format('YYYY-MM-DD__HH.mm.ss')}.json`);
    console.log(`Jobs backup started. Backup file is ${filename}`);

    this._initFile()
        .then(data => {
          const encryptedJobs = {};
          const encryptedJobsAsArray = _.where(data.jobs, {encrypted: true});
          _.each(encryptedJobsAsArray, function (job) {
            encryptedJobs[job.id] = job;
          });

          jf.writeFile(filename, {jobs: encryptedJobs, sequence: data.sequence}, {spaces: 2})
              .then(() => {
                console.log(`Backup of encrypted jobs written to ${filename}.`)
              })
              .catch(reason => {
                console.log(`EXCEPTION while writing the jobs backup file ${filename}: ${reason}`)
              });
        })
        .catch(reason => {
          console.log(`EXCEPTION while backing up jobs: ${reason}`)
        });
  },

  /* updates job information */
  saveJob: async function (job) {
    if (job.id === undefined) {
      const err = "ERROR: attempt to save incomplete job";
      console.log(err);
      throw new Error(err);
    }
    let data = await this._initFile();
    if (data.jobs[job.id]) {
      if (data.jobs[job.id].encrypted) {
        throw new Error('job is encrypted');
      } else {
        _.extend(data.jobs[job.id],
            _.pick(job, 'encrypted', 'start', 'end', 'title', 'number', 'keyword', 'catchword', 'longitude', 'latitude', 'street',
                'streetnumber', 'city',
                'object', 'resource', 'plan', 'images', 'attendees', 'report'));
        return new Promise((resolve, reject) => {
          jf.writeFile(this.filename, data, {spaces: 2})
              .then(() => {
                resolve(data.jobs[job.id]);
              })
              .catch(reason => {
                reject(reason);
              });
        });
      }
    } else {
      throw new Error("Job does not exist")
    }
  },

  deleteJob: async function (id) {
    if (id === undefined) {
      const err = "ERROR: attempt to delete job with undefined id";
      console.log(err);
      throw new Error(err);
    }
    let data = await this._initFile();
    delete data.jobs[id];
    return new Promise((resolve, reject) => {
      jf.writeFile(this.filename, data, {spaces: 2})
          .then(() => {
            resolve(id);
          })
          .catch(reason => {
            reject(reason);
          });
    });
  },

  _encrypt: async function (job) {
    const encryptionPublicKey = config.get('encryptionPublicKey');
    const encryptionKeyName = config.get('encryptionKeyName');
    return new Promise((resolve, reject) => {
      if (!encryptionPublicKey) {
        reject(new Error("encryptionPublicKey is not configured"));
        return;
      }
      if (!encryptionKeyName) {
        reject(new Error("encryptionKeyName is not configured"));
        return;
      }
      crypto.randomBytes(32, (err, aesSecret) => {
        if (err) {
          reject(err);
          return;
        }

        // create initialization vector
        crypto.randomBytes(16, (err, iv) => {
          if (err) {
            reject(err);
            return;
          }
          // console.log(`${aesSecret.length} bytes of random data: ${aesSecret.toString('hex')}`);

          console.log(`Encrypting AES random key with public key ${encryptionKeyName}`);
          let encryptedRandom = crypto.publicEncrypt(encryptionPublicKey, aesSecret);
          job.encryptedRandomBase64 = encryptedRandom.toString("base64");
          job.encryptionRandomIvBase64 = iv.toString("base64");

          const keys = ['longitude', 'latitude', 'street', 'streetnumber', 'city', 'object', 'plan', 'attendees', 'images', 'report'];
          const o = _.pick(job, keys);
          const oStr = JSON.stringify(o);

          // encrypt data
          let cipher = crypto.createCipheriv('aes-256-cbc', aesSecret, iv);
          const buffer = Buffer.from(oStr);
          let encryptedData = cipher.update(buffer, 'utf8', 'hex') + cipher.final('hex');

          let encryptedJob = _.omit(job, keys);
          encryptedJob.encrypted = true;
          encryptedJob.encryptedData = encryptedData;
          resolve(encryptedJob);
        });
      });
    });
  },

  _decrypt: async function (job, keyObj) {
    return new Promise((resolve, reject) => {
      if (!keyObj || !keyObj.encryptedPrivateKey) {
        reject(new Error("Can't decrypt without private key"));
        return;
      }
      if (!keyObj || !keyObj.passphrase) {
        reject(new Error("Can't decrypt without private key passphrase"));
        return;
      }
      let iv;
      const encryptedAesSecret = Buffer.from(job.encryptedRandomBase64, 'base64');
      if (job.encryptionRandomIvBase64) {
        iv = Buffer.from(job.encryptionRandomIvBase64, 'base64');
      }

      let aesSecret = crypto.privateDecrypt({key: keyObj.encryptedPrivateKey, passphrase: keyObj.passphrase}, encryptedAesSecret);

      // decrypt data
      let decipher = crypto.createDecipheriv('aes-256-cbc', aesSecret, iv);
      const encryptedText = new Buffer(job.encryptedData, 'hex');
      const decrypted = decipher.update(encryptedText, 'utf-8') + decipher.final('utf-8');
      try {
        let decryptedJobData = JSON.parse(decrypted.toString());
        job = _.omit(job, ['encryptedData', 'encryptedRandomBase64', 'encryptionRandomIvBase64']);
        job = _.extend(job, decryptedJobData, {encrypted: false});
        resolve(job);
      } catch (ex) {
        reject(ex);
      }
    });
  },

  _prepareJobByIdOrObj: async function (id) {
    let job, data;
    if (_.isObject(id)) {
      job = id; // job was passed instead id
      if (job.id === undefined) {
        throw new Error('job object has no id');
      }
      data = await this._initFile();
    } else {
      if (id === undefined) {
        throw new Error('id is undefined');
      }
      data = await this._initFile();
      job = data.jobs[id];
      if (!job) {
        throw new Error(`there is no job with id ${id}`);
      }
      job.id = id;
    }
    return {job, data};
  },

  encryptJob: function (id) {
    return new Promise(async (resolve, reject) => {
      try {
        let {job, data} = await this._prepareJobByIdOrObj(id);
        const encryptedJob = await this._encrypt(job);
        data.jobs[job.id] = encryptedJob;
        jf.writeFile(this.filename, data, {spaces: 2})
            .then(() => {
              resolve(encryptedJob);
            })
            .catch(reason => {
              reject(reason);
            });
      } catch (ex) {
        ex.message = `ERROR while encrypting job: ${ex.message}`;
        reject(ex);
      }
    });
  },

  decryptJob: function (id, keyObj) {
    return new Promise(async (resolve, reject) => {
      try {
        let {job, data} = await this._prepareJobByIdOrObj(id);
        const decryptedJob = await this._decrypt(job, keyObj);
        data.jobs[job.id] = decryptedJob;
        jf.writeFile(this.filename, data, {spaces: 2})
            .then(() => {
              resolve(decryptedJob);
            })
            .catch(reason => {
              reject(reason);
            });
      } catch (ex) {
        ex.message = `decrypting job: ${ex.message}`;
        reject(ex);
      }
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

Jobs.extend = extend;

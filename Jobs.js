const fs = require('fs');
const path = require('path');
const jf = require('jsonfile');
const _ = require('underscore');
const moment = require('moment');
const config = require('./config');
const crypto = require('crypto');

const jobsDataFilename = 'jobs.json';
let jobsDataFileLocked = false;

function _unlockJobsDataFile() {
  jobsDataFileLocked = false;
}

_unlockJobsDataFile();

let Jobs = module.exports = function () {
  this.filename = jobsDataFilename;

  this.initialize.apply(this, arguments);
};

_.extend(Jobs.prototype, {
  initialize: function () {
    this._locked = false;
  },

  lock: async function () {
    const self = this;
    // wait for any existing _flock based lock has been released
    await new Promise((resolve, reject) => {
      self._flock(resolve, reject);
    });
    this._locked = true;
  },

  unlock: function () {
    this._locked = false;
    _unlockJobsDataFile();
  },

  // the lock function must be a recursive timer
  _flock: function (resolve, reject) {
    // check if already locked with explicit lock function
    if (this._locked) {
      console.log('Skip locking with _flock, because already locked by lock()');
      resolve();
      return;
    }
    const self = this;
    if (jobsDataFileLocked) {
      console.log(jobsDataFilename + ' is locked. Trying again later...');
      setTimeout(() => {
        self._flock(resolve, reject)
      }, 250);
    } else {
      jobsDataFileLocked = true;
      resolve();
    }
  },

  _funlock: function () {
    // ignore unlock if explicitly locked by calling lock()
    if (!this._locked) {
      _unlockJobsDataFile();
    } else {
      console.log('Skip unlocking with _unlockJobsDataFile, because expecting to unlock with unlock()');
    }
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

  addJob: async function (job) {
    if (job) {
      let addedJob = await this._addJob(job);
      return addedJob;
    } else {
      throw new Error("job is undefined");
    }
  },

  // return the job data for the job identified by id
  //  if job is encrypted and keyObj is given in the arguments, return the decrypted job
  getJobById: async function (id, keyObj) {
    try {
      // console.log(`getJobById: _initFile`);
      let data = await this._initFile();
      let job = data.jobs[id];
      if (job) {
        if (job.encrypted && keyObj) {
          job = await this._decrypt(job, keyObj);
        }
        let jobData = _.pick(job, 'id', 'encrypted', 'encryptedRandomBase64', 'encryptionRandomIvBase64', 'encryptedData', 'start', 'end', 'title',
            'number', 'keyword', 'catchword', 'longitude', 'latitude', 'street', 'streetnumber', 'city', 'object', 'resource', 'plan', 'images',
            'attendees', 'report');
        jobData.id = id;
        // console.log(`getJobById: returning job ${id}`);
        return jobData;
      } else {
        throw new Error('Unknown job id');
      }
    } finally {
      // console.log(`getJobById: unlocking - finally`);
      this._funlock();
    }
  },

  /* return all jobs as array, sorted by start */
  getAll: async function () {
    try {
      // console.log(`getAll: _initFile`);
      let data = await this._initFile();
      if (data) {
        let jobs = _.map(data.jobs, function (job, key) {
          let oneJob = _.pick(job, 'encrypted', 'encryptedRandomBase64', 'encryptionRandomIvBase64', 'encryptedData', 'start', 'end', 'title',
              'number', 'keyword', 'catchword', 'longitude', 'latitude', 'street', 'streetnumber', 'city', 'object', 'resource', 'plan', 'images',
              'attendees', 'report');
          oneJob.id = key;
          return oneJob;
        });
        // console.log(`getAll: returning sorted jobs`);
        return _.sortBy(jobs, 'start');
      } else {
        // console.log(`getAll: returning empty job list`);
        return [];
      }
    } finally {
      // console.log(`getAll: unlocking - finally`);
      this._funlock();
    }
  },

  _addJob: async function (encrypted, start, end, title, number, keyword, catchword, longitude, latitude, street, streetnumber, city, object, resource, plan,
      images, attendees, report) {
    try {
      console.log(`_addJob: _initFile`);
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
          attendees: o.attendees,
          report: o.report
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
          attendees: attendees,
          report: report
        };
      }
      data.jobs[id] = job;

      const filename = this.filename;
      const addedJob = await new Promise((resolve, reject) => {
        jf.writeFile(filename, data, {spaces: 2})
            .then(() => {
              console.log(`_addJob: ${filename} written`);
              resolve(job);
            })
            .catch(reason => {
              console.log(`_addJob: error writing ${filename}`);
              reject(reason);
            });
        console.log(`_addJob: started writing ${filename}`);
      });
      console.log(`_addJob: returning added job`);
      return addedJob;
    } finally {
      console.log(`_addJob: unlocking - finally`);
      this._funlock();
    }
  },

  backupJobs: async function () {
    const filename = path.join(__dirname, `jobs.backup.${moment().format('YYYY-MM-DD__HH.mm.ss')}.json`);
    console.log(`Jobs backup started. Backup file is ${filename}`);
    try {
      // console.log(`backupJobs: _initFile`);
      let data = await this._initFile();
      const encryptedJobs = {};
      const encryptedJobsAsArray = _.where(data.jobs, {encrypted: true});
      _.each(encryptedJobsAsArray, function (job) {
        encryptedJobs[job.id] = job;
      });

      await new Promise((resolve, reject) => {
        jf.writeFile(filename, {jobs: encryptedJobs, sequence: data.sequence}, {spaces: 2})
            .then(() => {
              console.log(`Backup of encrypted jobs written to ${filename}`);
              resolve();
            })
            .catch(reason => {
              reject(reason)
            });
      });
    } catch (ex) {
      console.log(`EXCEPTION while backing up jobs: ${ex}`)
    } finally {
      // console.log("backupJobs: unlocking in finally");
      this._funlock();
    }
  },

  /* updates job information */
  saveJob: async function (job) {
    if (job.id === undefined) {
      const err = "ERROR: attempt to save incomplete job";
      console.log(err);
      throw new Error(err);
    }
    try {
      console.log(`saveJob: _initFile`);
      let data = await this._initFile();

      if (data.jobs[job.id]) {
        if (data.jobs[job.id].encrypted) {
          throw new Error('job is encrypted');
        } else {
          _.extend(data.jobs[job.id],
              _.pick(job, 'encrypted', 'start', 'end', 'title', 'number', 'keyword', 'catchword', 'longitude', 'latitude', 'street',
                  'streetnumber', 'city',
                  'object', 'resource', 'plan', 'images', 'attendees', 'report'));
          const filename = this.filename;
          let savedJob = await new Promise((resolve, reject) => {
            jf.writeFile(filename, data, {spaces: 2})
                .then(() => {
                  console.log(`saveJob: ${filename} written`);
                  resolve(data.jobs[job.id]);
                })
                .catch(reason => {
                  console.log(`saveJob: error writing ${filename}`);
                  reject(reason);
                });
            console.log(`saveJob: started writing ${filename}...`);
          });
          console.log(`saveJob: returning saved job`);
          return savedJob;
        }
      } else {
        throw new Error("Job does not exist")
      }
    } finally {
      console.log("saveJob: unlocking in finally");
      this._funlock();
    }
  },

  deleteJob: async function (id) {
    if (id === undefined) {
      const err = "ERROR: attempt to delete job with undefined id";
      console.log(err);
      throw new Error(err);
    }
    try {
      console.log(`deleteJob: _initFile`);
      let data = await this._initFile();
      delete data.jobs[id];
      const filename = this.filename;
      const id = await new Promise((resolve, reject) => {
        jf.writeFile(filename, data, {spaces: 2})
            .then(() => {
              console.log(`deleteJob: ${filename} written`);
              resolve(id);
            })
            .catch(reason => {
              console.log(`deleteJob: error writing ${filename}`);
              reject(reason);
            });
        console.log(`deleteJob: started writing ${filename}...`);
      });
      console.log(`deleteJob: returning id ${id}`);
      return id;
    } finally {
      console.log("deleteJob: unlocking in finally");
      this._funlock();
    }
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
      const encryptedText = Buffer.from(job.encryptedData, 'hex');
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
      console.log(`_prepareJobByIdOrObj: _initFile`);
      data = await this._initFile();
    } else {
      if (id === undefined) {
        throw new Error('id is undefined');
      }
      console.log(`_prepareJobByIdOrObj: _initFile`);
      data = await this._initFile();
      job = data.jobs[id];
      if (!job) {
        throw new Error(`there is no job with id ${id}`);
      }
      job.id = id;
    }
    return {job, data};
  },

  encryptJob: async function (id) {
    try {
      let {job, data} = await this._prepareJobByIdOrObj(id);
      const encryptedJob = await this._encrypt(job);
      data.jobs[job.id] = encryptedJob;
      const filename = this.filename;
      let ej = await new Promise((resolve, reject) => {
        jf.writeFile(filename, data, {spaces: 2})
            .then(() => {
              console.log(`encryptJob: ${filename} written`);
              resolve(encryptedJob);
            })
            .catch(reason => {
              console.log(`encryptJob: error writing ${filename}`);
              reject(reason);
            });
        console.log(`encryptJob: started writing ${filename}`);
      });
      console.log(`encryptJob: returning encrypted job`);
      return ej;
    } catch (ex) {
      ex.message = `ERROR while encrypting job: ${ex.message}`;
      throw ex;
    } finally {
      console.log("encryptJob: unlocking in finally");
      this._funlock();
    }
  },

  decryptJob: async function (id, keyObj) {
    try {
      let {job, data} = await this._prepareJobByIdOrObj(id);
      const decryptedJob = await this._decrypt(job, keyObj);
      data.jobs[job.id] = decryptedJob;
      const filename = this.filename;
      let dj = await new Promise((resolve, reject) => {
        jf.writeFile(filename, data, {spaces: 2})
            .then(() => {
              console.log(`decryptJob: ${filename} written`);
              resolve(decryptedJob);
            })
            .catch(reason => {
              console.log(`decryptJob: error writing ${filename}`);
              reject(reason);
            });
        console.log(`decryptJob: started writing ${filename}`);
      });
      console.log(`decryptJob: returning encrypted job`);
      return dj;
    } catch (ex) {
      ex.message = `decrypting job failed: ${ex.message}`;
      throw ex;
    } finally {
      console.log("decryptJob: unlocking in finally");
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

Jobs.extend = extend;

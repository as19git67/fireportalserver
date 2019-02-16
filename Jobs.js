const fs = require('fs');
const jf = require('jsonfile');
const _ = require('underscore');
const moment = require('moment');

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
          let data = {jobs: {}};
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
      let jobData = _.pick(job, 'id', 'start', 'end', 'title', 'number', 'keyword', 'catchword', 'longitude', 'latitude', 'street', 'streetnumber', 'city',
          'object', 'resource', 'plan', 'images', 'attendees', 'report');
      jobData.id = id;
      return jobData;
    }
  },

  /* return all jobs as array, sorted by start */
  getAll: async function () {
    let data = await this._initFile();
    if (data) {
      let jobs = _.map(data.jobs, function (job, key) {
        let oneJob = _.pick(job, 'start', 'end', 'title', 'number', 'keyword', 'catchword', 'longitude', 'latitude', 'street', 'streetnumber', 'city',
            'object', 'resource', 'plan', 'images', 'attendees', 'report');
        oneJob.id = key;
        return oneJob;
      });
      return _.sortBy(jobs, 'start');
    } else {
      return [];
    }
  },

  _addJob: async function (start, end, title, number, keyword, catchword, longitude, latitude, street, streetnumber, city, object, resource, plan, images,
      attendees) {
    let data = await this._initFile();
    const id = data.sequence;
    data.sequence++;
    let job;

    if (_.isObject(start)) {
      let o = start;
      job = {
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

  /* updates job information */
  saveJob: async function (job) {
    if (job.id === undefined) {
      const err = "ERROR: attempt to save incomplete job";
      console.log(err);
      throw new Error(err);
    }
    let data = await this._initFile();
    if (data.jobs[job.id]) {
      _.extend(data.jobs[job.id],
          _.pick(job, 'start', 'end', 'title', 'number', 'keyword', 'catchword', 'longitude', 'latitude', 'street', 'streetnumber', 'city',
              'object', 'resource', 'plan', 'images', 'attendees', 'report'));
      return new Promise((resolve, reject) => {
        jf.writeFile(this.filename, data, {spaces: 2})
            .then(() => {
              resolve(job);
            })
            .catch(reason => {
              reject(reason);
            });
      });
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

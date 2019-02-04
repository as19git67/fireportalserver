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

  _initFile: function (callback) {
    const self = this;
    fs.exists(this.filename, function (exists) {
      if (!exists) {
        let data = {jobs: {}, sequence: 0};
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

  addJob: function (job, callback) {
    const self = this;
    if (job) {
      self._addJob(job, function (err, addedJob) {
        callback(err, addedJob);
      });
    } else {
      callback("job is undefined");
    }
  },

  getJobById: function (id, callback) {
    const self = this;
    this._initFile(function (data) {
      //const job = _.findWhere(data.jobs, {id: id});
      const job = data.jobs[id];
      if (job) {
        callback(null, _.pick(job, 'id', 'start', 'end', 'title', 'number', 'keyword', 'catchword', 'longitude', 'latitude', 'street', 'streetnumber', 'city',
            'object', 'resource', 'plan', 'images', 'attendees', 'report'));
      } else {
        callback(null, null);
      }
    });
  },

  /* return all jobs as array, sorted by start */
  getAll: function (callback) {
    this._initFile(function (data) {
      if (data) {
        let jobs = _.map(data.jobs, function (job, key) {
          let oneJob = _.pick(job, 'start', 'end', 'title', 'number', 'keyword', 'catchword', 'longitude', 'latitude', 'street', 'streetnumber', 'city',
              'object', 'resource', 'plan', 'images', 'attendees', 'report');
          oneJob.id = key;
          return oneJob;
        });
        callback(null, _.sortBy(jobs, 'start'));
      } else {
        callback(null, []);
      }
    });
  },

  _addJob: function (start, end, title, number, keyword, catchword, longitude, latitude, street, streetnumber, city, object, resource, plan, images, attendees,
      callback) {
    const self = this;
    this._initFile(function (data) {
      const id = data.sequence;
      data.sequence++;
      let job;

      if (_.isObject(start)) {
        let o = start;
        callback = end;
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

      jf.writeFile(self.filename, data, function (err) {
        if (err) {
          callback(err);
        } else {
          callback(null, job);
        }
      });
    });
  },

  /* updates job information */
  saveJob: function (job, callback) {
    if (job.id === undefined) {
      const err = "ERROR: attempt to save incomplete job";
      console.log(err);
      callback(err);
      return;
    }
    const self = this;
    this._initFile(function (data) {
      if (data.jobs[job.id]) {
        _.extend(data.jobs[job.id],
            _.pick(job, 'start', 'end', 'title', 'number', 'keyword', 'catchword', 'longitude', 'latitude', 'street', 'streetnumber', 'city',
                'object', 'resource', 'plan', 'images', 'attendees', 'report'));
        jf.writeFile(self.filename, data, function (error) {
          if (error) {
            callback(error);
          } else {
            callback(null);
          }
        });
      } else {
        callback("Job does not exist")
      }
    });
  },

  deleteJob: function (id, callback) {
    if (id === undefined) {
      const err = "ERROR: attempt to delete job with undefined id";
      console.log(err);
      callback(err);
      return;
    }
    const self = this;
    this._initFile(function (data) {
      delete data.jobs[id];
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

Jobs.extend = extend;

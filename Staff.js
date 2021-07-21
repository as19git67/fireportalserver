const fs = require('fs');
const jf = require('jsonfile');
const _ = require('underscore');

let Staff = module.exports = function (options) {
  options || (options = {});
  this.filename = "staff.json";

  this.initialize.apply(this, arguments);
};

_.extend(Staff.prototype, {
  initialize: function () {
  },

  _initFile: async function () {
    const self = this;
    return new Promise((resolve, reject) => {
      fs.exists(this.filename, function (exists) {
        if (!exists) {
          let data = {staff: {}};
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

  _addGroup: async function (id, name, description, responsibleEmail) {
    try {
      console.log(`_addGroup: _initFile`);
      let data = await this._initFile();

      if (data.groups[id]) {
        throw new Error(`Group with id ${id} already exists`);
      }
      const group = {
        id: id,
        name: name,
        description: description,
        responsibleEmail: responsibleEmail
      };

      data.groups[id] = group;

      const filename = this.filename;
      const addedGroup = await new Promise((resolve, reject) => {
        jf.writeFile(filename, data, {spaces: 2})
        .then(() => {
          console.log(`_addGroup: ${filename} written`);
          resolve(group);
        })
        .catch(reason => {
          console.log(`_addGroup: error writing ${filename}`);
          reject(reason);
        });
        console.log(`_addGroup: started writing ${filename}`);
      });
      console.log(`_addGroup: returning added group`);
      return addedGroup;
    } finally {
      console.log(`_addGroup: unlocking - finally`);
      this._funlock();
    }
  },

  /* adds a new group */
  addGroup: async function (id, name, description, responsibleEmail) {
    if (id && name) {
      let addedGroup = await this._addGroup(id, name, description, responsibleEmail);
      return addedGroup;
    } else {
      throw new Error("group id or name is undefined");
    }
  },

  /* updates group information */
  saveGroup: async function (group) {
    if (group.id === undefined) {
      const err = "ERROR: attempt to save group without id";
      console.log(err);
      throw new Error(err);
    }
    try {
      // console.log(`saveGroup: _initFile`);
      let data = await this._initFile();

      if (data.groups[group.id]) {
        _.extend(data.groups[group.id], _.pick(group, 'name', 'description', 'responsibleEmail'));
        const filename = this.filename;
        let savedGroup = await new Promise((resolve, reject) => {
          jf.writeFile(filename, data, {spaces: 2})
          .then(() => {
            console.log(`saveGroup: ${filename} written`);
            resolve(data.groups[group.id]);
          })
          .catch(reason => {
            console.log(`saveGroup: error writing ${filename}`);
            reject(reason);
          });
          // console.log(`saveGroup: started writing ${filename}...`);
        });
        // console.log(`saveGroup: returning saved group`);
        return savedGroup;
      } else {
        throw new Error("Group does not exist");
      }
    } finally {
      // console.log("saveGroup: unlocking in finally");
      this._funlock();
    }
  },

  deleteGroup: async function (groupId) {
    if (groupId === undefined) {
      const err = "ERROR: attempt to delete group with undefined id";
      console.log(err);
      throw new Error(err);
    }
    if (_.isString(groupId)) {
      groupId = parseInt(groupId);
    }
    if (isNaN(groupId)) {
      const err = "ERROR: attempt to delete group with id that is not a number";
      console.log(err);
      throw new Error(err);
    }
    try {
      console.log(`deleteGroup: _initFile`);
      let data = await this._initFile();
      delete data.groups[groupId];
      const filename = this.filename;
      const id = await new Promise((resolve, reject) => {
        jf.writeFile(filename, data, {spaces: 2})
        .then(() => {
          console.log(`deleteGroup: ${filename} written`);
          resolve(groupId);
        })
        .catch(reason => {
          console.log(`deleteGroup: error writing ${filename}`);
          reject(reason);
        });
        console.log(`deleteGroup: started writing ${filename}...`);
      });
      console.log(`deleteGroup: returning id ${id}`);
      return id;
    } finally {
      console.log("deleteGroup: unlocking in finally");
      this._funlock();
    }
  },

  getGroups: async function () {
    let data = await this._initFile();
    if (data && data.staff && _.isArray(data.staff)) {
      if (data.staff.groups) {
        return data.staff.groups;
      } else {
        return [];
      }
    } else {
      return [];
    }
  },

  getAll: async function (groupId) {
    let data = await this._initFile();
    if (data && data.staff && _.isArray(data.staff)) {

      let allOfGroup = _.where(data.staff, {groupId: groupId});
      let sortedStaff = _.sortBy(allOfGroup, function (person) {
        return person.lastname + person.firstname;
      });

      return _.map(sortedStaff, function (person) {
        return {
          id: person.id,
          lastname: person.lastname,
          firstname: person.firstname
        };
      });
    } else {
      return [];
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

Staff.extend = extend;

const slugify = require("slugify");

const slugifyString = (name = '') => {
  let formattedName = name.toLowerCase();
  formattedName = formattedName.trim();
  
  return slugify(formattedName);
};
exports.slugifyString = slugifyString;

String.prototype.startsWith = function(string = '', position = 0){
    return this.indexOf(string, position) === position
}
String.prototype.endsWith = function(string = '', position){
    if (!position) position = string.length - 1;
    return this.lastIndexOf(string, position) === position
}
String.prototype.includes = function(string = '', position = 0){
    return this.indexOf(string, position) !== -1
}

/**
 * @param {Number} min 
 * @param {Number} value 
 * @param {Number} max 
 * @returns {Number}
 */
Math.clamp = function(min = 0, value, max = 1){
    if (isNaN(value)) return min;
    return Math.min(max, Math.max(value, min))
}

/**
 * @param {Number} min 
 * @param {Number} value 
 * @param {Number} max 
 */
Math.onRange = function(min, value, max){
    if (isNaN(min)) min = 0;
    if (isNaN(max)) max = 1;
    return value >= min && value <= max;
}

module.exports = {};


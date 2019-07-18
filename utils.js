export const prettyError = (error) => {
  let err = error;
  err = (err.message) ? err.message : err;
  err = (err.fields) ? err.fields : err;
  err = (err.replyText) ? err.replyText : err;
  const arr = (err.split) ? err.split('\n') : [err];
  return arr[0];
};

/* global Promise */
export const wait = (delay) => {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
};

export const pad = (what, len = 2, p = '0') => {
  let str = '' + what;
  while (str.length < len) { str = p + str; }
  return str;
};

export const getStamp = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}.${pad(now.getUTCMilliseconds(), 3)}Z`;
};

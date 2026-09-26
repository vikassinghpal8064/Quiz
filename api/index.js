// The one serverless function in this project. Every /api/* request is
// rewritten here by vercel.json and forwarded to the matching handler by
// api/_lib/dispatch.js.
//
// Do not add a second file directly under api/: each one becomes another
// serverless function, and the Hobby plan allows at most 12 per deployment.
// See api/_lib/dispatch.js for why this is not a catch-all route.
export { default } from "./_lib/dispatch.js";

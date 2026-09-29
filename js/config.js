/* Site feature flags — product policy, not Firebase credentials or story content. */
window.SITE_CONFIG = {
  /** When true, voters can change destination or undo. When false, first vote is final. */
  allowChangeVote: false,
  /** Vote API origin. No secrets. */
  voteApiUrl: "http://127.0.0.1:8787",
};

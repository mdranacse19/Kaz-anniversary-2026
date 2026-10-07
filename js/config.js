/* Site feature flags — product policy, not Firebase credentials or story content. */
window.SITE_CONFIG = {
  /** When true, voters can change destination or undo. When false, first vote is final. */
  allowChangeVote: false,
  /** Vote API origin. No secrets. Empty = same origin when deployed, local vote-api on localhost. */
  voteApiUrl: "",
  /**
   * No new vote or code is accepted at or after this instant. Empty = voting stays open.
   * Bangladesh time, for example "2026-10-15T23:59:59+06:00".
   */
  votingClosesAt: "2026-10-09T23:59:59+06:00",
};

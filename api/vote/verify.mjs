import { handle, routes } from "../../server/vote-handlers.mjs";

export default (req, res) => handle(req, res, routes["/api/vote/verify"]);

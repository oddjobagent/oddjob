export { redactString, deepRedact, redactStringified } from "./redact.ts";
export {
  startEgressProxy,
  assertSafeBindAddress,
  isPrivateOrSensitiveIP,
  type EgressProxyOptions,
  type EgressProxyHandle,
} from "./proxy.ts";
export { hostMatches, makeHostMatcher } from "./host-match.ts";

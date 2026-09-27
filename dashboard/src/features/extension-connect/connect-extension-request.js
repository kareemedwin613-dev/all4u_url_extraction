// Parses the extension's Connect link. The confirmation code is derived from the challenge on both
// sides (the extension computes the same code), so a user only approves the extension in front of them.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function confirmationCode(challenge) {
  const value = String(challenge || "").toUpperCase();
  return `${value.slice(0, 3)}-${value.slice(3, 6)}`;
}

export function parseConnectRequest(query) {
  const params = new URLSearchParams(String(query || ""));
  const pairingId = String(params.get("pairing") || ""), challenge = String(params.get("challenge") || "");
  if (!UUID_V4.test(pairingId) || !/^[0-9a-f]{64}$/.test(challenge)) return null;
  return { pairingId, challenge, code: confirmationCode(challenge) };
}

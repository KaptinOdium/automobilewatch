let identity = null;
export function setIdentity(value) { identity = value ? Object.freeze({...value}) : null; }
export function getIdentity() { return identity; }
export function getUserId() { return identity?.id || null; }

export const equal = (lhs: Uint8Array, rhs: Uint8Array): boolean => {
  if (lhs.length !== rhs.length) {
    return false;
  }

  for (let i = 0; i < lhs.length; i++) {
    if (lhs[i] !== rhs[i]) {
      return false;
    }
  }

  return true;
};

export interface PasswordStrength {
  score: number;
  feedback: string[];
  isStrong: boolean;
}

const COMMON_WEAK_PATTERNS = [
  /password/i,
  /qwerty/i,
  /12345/,
  /letmein/i,
  /admin/i,
  /welcome/i,
];

export const validatePasswordStrength = (password: string): PasswordStrength => {
  const feedback: string[] = [];
  let score = 0;

  if (password.length >= 12) {
    score++;
  } else {
    feedback.push('Password must be at least 12 characters');
  }

  if (/[a-z]/.test(password)) {
    score++;
  } else {
    feedback.push('Password must contain a lowercase letter');
  }

  if (/[A-Z]/.test(password)) {
    score++;
  } else {
    feedback.push('Password must contain an uppercase letter');
  }

  if (/[0-9]/.test(password)) {
    score++;
  } else {
    feedback.push('Password must contain a number');
  }

  if (/[^a-zA-Z0-9]/.test(password)) {
    score++;
  } else {
    feedback.push('Password must contain a special character');
  }

  if (COMMON_WEAK_PATTERNS.some((pattern) => pattern.test(password))) {
    feedback.push('Password contains common weak patterns');
    score = Math.max(0, score - 2);
  }

  return {
    score: Math.min(4, Math.floor((score / 5) * 4)),
    feedback,
    isStrong: feedback.length === 0,
  };
};

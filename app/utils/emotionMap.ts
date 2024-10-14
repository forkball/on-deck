export const emotionToCode: { [key: string]: number } = {
  JOY: 0,
  SADNESS: 1,
  FEAR: 2,
  ANGER: 3,
  SURPRISE: 4,
  DISGUST: 5,
  NOSTALGIA: 6,
  EXCITEMENT: 7,
  FRUSTRATION: 8,
  DELIGHT: 9,
  CONTEMPT: 10,
  ANXIETY: 11,
  BITTERNESS: 12,
  GRIEF: 13,
  AVERSION: 14,
  RAGE: 15,
  TERROR: 16,
  REVULSION: 17,
  OUTRAGE: 18,
  DISAPPOINTMENT: 19
};

export const codeToEmotion: { [key: number]: string } = Object.fromEntries(
  Object.entries(emotionToCode).map(([key, value]) => [value, key])
);

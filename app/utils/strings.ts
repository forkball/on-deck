function capitalCase(input: string) {
  const strArr = input.split(" ");
  const response = [];
  for (let i = 0; i < strArr.length; i++) {
    response.push(strArr[i].charAt(0).toUpperCase() + strArr[i].slice(1));
  }
  return response.join(" ");
}

export { capitalCase };

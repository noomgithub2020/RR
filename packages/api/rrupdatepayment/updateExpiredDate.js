exports.main = async function main(event) {
  return {
    statusCode: 200,
    body: {
      ok: true,
      message: 'handler reached',
      event
    }
  };
};
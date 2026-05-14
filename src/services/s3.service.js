const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3Config = { region: process.env.AWS_REGION };
if (process.env.AWS_ACCESS_KEY_ID) {
  s3Config.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}
const s3 = new S3Client(s3Config);

const uploadFileToS3 = async (buffer, originalname, mimetype, userId) => {
  const key = `uploads/${userId}/${Date.now()}-${originalname}`;
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
  });

  await s3.send(command);
  return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};

module.exports = { uploadFileToS3 };

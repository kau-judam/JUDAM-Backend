const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const EXPIRES_IN_SECONDS = 300; // 5분

const generatePresignedUrl = async (userId, filename, fileType) => {
  const key = `uploads/${userId}/${Date.now()}-${filename}`;
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET,
    Key: key,
    ContentType: fileType,
  });

  const presignedUrl = await getSignedUrl(s3, command, { expiresIn: EXPIRES_IN_SECONDS });
  const s3Url = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

  return { presignedUrl, s3Url };
};

module.exports = { generatePresignedUrl };

import mongoose from "mongoose";


const  generateUniqueCode = () => Math.floor(100000 + Math.random() * 900000).toString();


const verificationCodeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  type: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now(),
  },

  expiresAt: {
    type: Date,
    required: true,
  },

  code: {
    type: String,
    default: () => generateUniqueCode(),
  },
});


verificationCodeSchema.pre("save", async function (next) {
  const existingCode = await VerificationCodeModel.findOne({ code: this.code });
  if (existingCode) {
    this.code = generateUniqueCode(); // Generate a new code if there's a collision
  }
  next();
});



export const VerificationCodeModel = mongoose.model("VerificationCode", verificationCodeSchema);
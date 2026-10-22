import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, minlength: 3, maxlength: 24 },
  displayName: { type: String, required: true, trim: true, maxlength: 60 },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  avatarUrl: { type: String, default: '', maxlength: 2048 },
  lastSeenAt: { type: Date, default: Date.now }
}, { timestamps: true, toJSON: { transform: (_doc, ret) => { delete ret.passwordHash; delete ret.__v; return ret; } } });

const conversationSchema = new mongoose.Schema({
  conversationType: { type: String, enum: ['private'], default: 'private' },
  participantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lastMessageAt: { type: Date, default: Date.now },
  lastReadAt: { type: Map, of: Date, default: {} }
}, { timestamps: true });
conversationSchema.index({ participantIds: 1, lastMessageAt: -1 });

const invitationSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, select: false },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null }
}, { timestamps: true });
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 20000 },
  clientMessageId: { type: String, required: true, maxlength: 80 },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deletedAt: { type: Date, default: null }
}, { timestamps: true });
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
messageSchema.index({ conversationId: 1, senderId: 1, createdAt: 1 });
messageSchema.index({ senderId: 1, clientMessageId: 1 }, { unique: true });

export const User = mongoose.model('User', userSchema);
export const Conversation = mongoose.model('Conversation', conversationSchema);
export const Invitation = mongoose.model('Invitation', invitationSchema);
export const Message = mongoose.model('Message', messageSchema);

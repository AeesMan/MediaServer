const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fileUpload = require("express-fileupload");
const cloudinary = require("cloudinary").v2;
const bcrypt = require("bcrypt");
const app = express();

cloudinary.config({
  cloud_name: "dz9uyygy2",
  api_key: "795616917557494",
  api_secret: "qtYiNSSkSG-3FWVRLycddrKKM0M",
});

app.use(fileUpload({ useTempFiles: true, tempFileDir: "/tmp/" }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

mongoose
  .connect("mongodb://127.0.0.1:27017/mediaCollection", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

function getPublicIdFromUrl(url) {
  const uploadIndex = url.indexOf('/upload/');
  if (uploadIndex === -1) return null;

  const publicPart = url.slice(uploadIndex + 8); // після '/upload/'
  const parts = publicPart.split('.');
  parts.pop(); // видалити розширення
  return parts.join('.');
}


const trackSchema = new mongoose.Schema({
  name: { type: String, required: true },
  author: { type: String, required: true },
  filePath: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
});


const Track = mongoose.model("Track", trackSchema);

const videoSchema = new mongoose.Schema({
  name: { type: String, required: true },
  author: { type: String, required: true },
  filePath: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
});


const Video = mongoose.model("Video", videoSchema);

//  User
const userSchema = new mongoose.Schema({
  login: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  usedStorage: { type: Number, default: 0 },
});


userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", userSchema);

// === AUTH ===

app.post("/auth/register", async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: "Login and password required" });
    }

    const userExists = await User.findOne({ login });
    if (userExists) {
      return res.status(400).json({ error: "User already exists" });
    }

    const newUser = new User({ login, password });
    await newUser.save();

    res.status(201).json({ message: "User registered", userId: newUser._id });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { login, password } = req.body;
    const user = await User.findOne({ login });

    if (!user) return res.status(404).json({ error: "User not found" });

    const match = await user.comparePassword(password);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    // Вивести userId в консоль для тесту
    console.log(`Logged in user ID: ${user._id}`);

    res.status(200).json({ message: "Login successful", userId: user._id });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});



// Отримати дані користувача за ID (для профілю)
app.get("/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json(user);
  } catch (err) {
    console.error("Get user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// === UPLOADS ===
app.post("/uploads", async (req, res) => {
  try {
    const { name, author, userId } = req.body;
    const file = req.files?.file;
    if (!file) return res.status(400).send({ error: "No file uploaded" });

    const allowedTypes = ["audio/wav", "audio/mpeg"];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).send({ error: "Invalid file type" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).send({ error: "User not found" });

    const fileSize = file.size;
    const maxStorage = 2 * 1024 * 1024 * 1024;

    if (user.usedStorage + fileSize > maxStorage) {
      return res.status(400).send({ error: "Storage limit exceeded (2 GB)" });
    }

    const uniqueId = Date.now();
    const result = await cloudinary.uploader.upload(file.tempFilePath, {
      resource_type: "video",
      folder: `users/${user._id}/audio`,
      public_id: `${uniqueId}_${file.name.split('.')[0]}`
    });

    const track = new Track({
      name,
      author: user.login,
      filePath: result.secure_url,
      user: user._id
    });

    await track.save();

    user.usedStorage += fileSize;
    await user.save();

    res.status(200).send({ message: "Uploaded successfully", track });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Upload failed" });
  }
});

app.post("/uploads/video", async (req, res) => {
  try {
    const { name, author, userId } = req.body;
    const file = req.files?.file;
    if (!file) return res.status(400).send({ error: "No file uploaded" });

    const allowedTypes = ["video/mp4", "video/webm"];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).send({ error: "Invalid file type" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).send({ error: "User not found" });

    const fileSize = file.size;
    const maxStorage = 2 * 1024 * 1024 * 1024;

    if (user.usedStorage + fileSize > maxStorage) {
      return res.status(400).send({ error: "Storage limit exceeded (2 GB)" });
    }

    const result = await cloudinary.uploader.upload(file.tempFilePath, {
      resource_type: "video",
      folder: `users/${user._id}/video`,
    });

    const video = new Video({
      name,
      author: user.login,
      filePath: result.secure_url,
      user: user._id
    });

    await video.save();

    user.usedStorage += fileSize;
    await user.save();

    res.status(200).send({ message: "Video uploaded", video });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).send({ error: "Upload failed" });
  }
});

// === DELETE ===

app.delete("/uploads/:id", async (req, res) => {
  try {
    const { userId } = req.query;

    const track = await Track.findByIdAndDelete(req.params.id);
    if (!track) return res.status(404).send({ message: "Track not found" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).send({ message: "User not found" });

    const publicId = getPublicIdFromUrl(track.filePath);

    let fileSize = 0;

    try {
      const resource = await cloudinary.api.resource(publicId, { resource_type: "video" });
      fileSize = resource.bytes;
    } catch (cloudErr) {
      console.warn("Cloudinary resource not found or error:", cloudErr.message);
    }

    await cloudinary.uploader.destroy(publicId, { resource_type: "video" });

    user.usedStorage = Math.max(0, user.usedStorage - fileSize);
    await user.save();

    res.status(200).send({ message: "Track deleted and storage updated" });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).send({ error: "Error deleting file" });
  }
});



app.delete("/uploads/video/:id", async (req, res) => {
  try {
    const { userId } = req.query;

    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).send({ message: "Video not found" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).send({ message: "User not found" });

    const publicId = getPublicIdFromUrl(video.filePath);
    if (!publicId) {
      return res.status(500).send({ error: "Invalid video filePath format" });
    }

    let fileSize = 0;
    try {
      const resource = await cloudinary.api.resource(publicId, { resource_type: "video" });
      fileSize = resource.bytes;
    } catch (cloudErr) {
      console.warn("Cloudinary resource not found or error:", cloudErr.message);
    }

    await cloudinary.uploader.destroy(publicId, { resource_type: "video" });

    await Video.deleteOne({ _id: req.params.id });

    user.usedStorage = Math.max(0, user.usedStorage - fileSize);
    await user.save();

    res.status(200).send({ message: "Video deleted and storage updated" });
  } catch (err) {
    console.error("Delete video error:", err);
    res.status(500).send({ error: "Error deleting video" });
  }
});


// === GET ===

// Отримати треки конкретного користувача
app.get("/tracks/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const tracks = await Track.find({ user: userId });
    res.json(tracks);
  } catch (err) {
    console.error("Error fetching tracks:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Отримати відео конкретного користувача
app.get("/videos/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const videos = await Video.find({ user: userId });
    res.json(videos);
  } catch (err) {
    console.error("Error fetching videos:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/auth/users", async (req, res) => {
  const users = await User.find({}, "-password"); // без паролів
  res.send(users);
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});

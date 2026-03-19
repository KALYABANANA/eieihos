"""
FacePsy Web Backend
- Face detection using MediaPipe Tasks API
- Action Unit detection using TFLite model
- Depression-related facial feature extraction
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import cv2
import numpy as np
from PIL import Image
import io
import base64
import os
import urllib.request

# Try to import tflite
try:
    import tflite_runtime.interpreter as tflite
except ImportError:
    import tensorflow.lite as tflite

# MediaPipe Tasks API
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

app = FastAPI(title="FacePsy Web API", version="1.0.0")

# CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Model paths
MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
AU_MODEL_PATH = os.path.join(MODEL_DIR, "AU_200.tflite")
FACE_LANDMARKER_PATH = os.path.join(MODEL_DIR, "face_landmarker.task")

# Download face landmarker model if not exists
def download_face_landmarker():
    if not os.path.exists(FACE_LANDMARKER_PATH):
        print("Downloading face_landmarker.task model...")
        os.makedirs(MODEL_DIR, exist_ok=True)
        url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
        urllib.request.urlretrieve(url, FACE_LANDMARKER_PATH)
        print("Download complete!")

# Initialize face landmarker / fallback
face_landmarker = None
face_mesh = None
face_detector = None

def init_face_landmarker():
    global face_landmarker, face_mesh
    download_face_landmarker()

    try:
        # Force CPU delegate to avoid GPU/OpenGL requirements on headless or restricted setups.
        base_options = python.BaseOptions(
            model_asset_path=FACE_LANDMARKER_PATH,
            delegate=python.BaseOptions.Delegate.CPU,
        )
        options = vision.FaceLandmarkerOptions(
            base_options=base_options,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
            num_faces=1
        )
        face_landmarker = vision.FaceLandmarker.create_from_options(options)
        print("Face landmarker initialized!")
        return True
    except Exception as e:
        face_landmarker = None
        print(f"Face landmarker init failed, falling back to FaceMesh: {e}")

    try:
        mp_solutions = getattr(mp, "solutions", None)
        if mp_solutions is None:
            raise AttributeError("mediapipe.solutions not available")
        face_mesh = mp_solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        print("Face mesh initialized (fallback).")
    except Exception as e:
        face_mesh = None
        print(f"Face mesh init failed: {e}")
    return False

def init_face_detector():
    """OpenCV Haar cascade fallback if MediaPipe is unavailable."""
    global face_detector
    try:
        cascade_path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
        detector = cv2.CascadeClassifier(cascade_path)
        if detector.empty():
            print("OpenCV face detector failed to load cascade.")
            face_detector = None
            return False
        face_detector = detector
        print("OpenCV face detector initialized (fallback).")
        return True
    except Exception as e:
        face_detector = None
        print(f"OpenCV face detector init failed: {e}")
        return False

# Load TFLite model for Action Units
interpreter = None

# Action Unit names
AU_NAMES = [
    "AU01 - Inner Brow Raiser",
    "AU02 - Outer Brow Raiser",
    "AU04 - Brow Lowerer",
    "AU06 - Cheek Raiser",
    "AU07 - Lid Tightener",
    "AU10 - Upper Lip Raiser",
    "AU12 - Lip Corner Puller",
    "AU14 - Dimpler",
    "AU15 - Lip Corner Depressor",
    "AU17 - Chin Raiser",
    "AU23 - Lip Tightener",
    "AU24 - Lip Pressor"
]

def load_au_model():
    global interpreter
    if os.path.exists(AU_MODEL_PATH):
        try:
            interpreter = tflite.Interpreter(model_path=AU_MODEL_PATH)
            interpreter.allocate_tensors()
            print(f"AU Model loaded successfully from {AU_MODEL_PATH}")
            return True
        except Exception as e:
            print(f"Error loading AU model: {e}")
            return False
    else:
        print(f"AU Model not found at {AU_MODEL_PATH}")
        return False

def preprocess_face_for_au(face_image):
    """Preprocess face image for AU detection (200x200 grayscale)"""
    # Convert to grayscale
    if len(face_image.shape) == 3:
        gray = cv2.cvtColor(face_image, cv2.COLOR_BGR2GRAY)
    else:
        gray = face_image

    # Apply median blur
    gray = cv2.medianBlur(gray, 5)

    # Apply histogram equalization
    gray = cv2.equalizeHist(gray)

    # Resize to 200x200
    resized = cv2.resize(gray, (200, 200))

    # Normalize
    normalized = (resized.astype(np.float32) - 128.0) / 128.0

    # Add batch and channel dimensions
    input_data = np.expand_dims(np.expand_dims(normalized, axis=0), axis=-1)

    return input_data

def detect_action_units(face_image):
    """Detect Action Units using TFLite model"""
    global interpreter

    if interpreter is None:
        return None

    try:
        # Preprocess
        input_data = preprocess_face_for_au(face_image)

        # Get input/output details
        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()

        # Set input tensor
        interpreter.set_tensor(input_details[0]['index'], input_data)

        # Run inference
        interpreter.invoke()

        # Get output
        output_data = interpreter.get_tensor(output_details[0]['index'])

        # Create AU results
        au_results = {}
        for i, name in enumerate(AU_NAMES):
            au_results[name] = float(output_data[0][i]) if i < len(output_data[0]) else 0.0

        return au_results
    except Exception as e:
        print(f"AU detection error: {e}")
        return None

def calculate_head_pose_from_matrix(transformation_matrix):
    """Extract head pose (Euler angles) from transformation matrix"""
    if transformation_matrix is None:
        return None

    try:
        # Extract rotation matrix (3x3) from 4x4 transformation matrix
        R = transformation_matrix[:3, :3]

        # Calculate Euler angles
        sy = np.sqrt(R[0, 0]**2 + R[1, 0]**2)
        singular = sy < 1e-6

        if not singular:
            x = np.arctan2(R[2, 1], R[2, 2])
            y = np.arctan2(-R[2, 0], sy)
            z = np.arctan2(R[1, 0], R[0, 0])
        else:
            x = np.arctan2(-R[1, 2], R[1, 1])
            y = np.arctan2(-R[2, 0], sy)
            z = 0

        return {
            "pitch": float(np.degrees(x)),
            "yaw": float(np.degrees(y)),
            "roll": float(np.degrees(z))
        }
    except Exception as e:
        print(f"Head pose calculation error: {e}")
        return None

def calculate_smile_from_landmarks(landmarks):
    """
    Calculate smile probability using NORMALIZED measurements
    Works for all face types by using relative proportions
    """
    try:
        # === Reference points for normalization ===
        # Face width: between outer eye corners (landmark 33 & 263)
        left_eye_outer = landmarks[33]
        right_eye_outer = landmarks[263]
        face_width = np.sqrt(
            (right_eye_outer.x - left_eye_outer.x)**2 +
            (right_eye_outer.y - left_eye_outer.y)**2
        )

        # Face height: from forehead to chin (landmark 10 & 152)
        forehead = landmarks[10]
        chin = landmarks[152]
        face_height = np.sqrt(
            (chin.x - forehead.x)**2 +
            (chin.y - forehead.y)**2
        )

        if face_width == 0 or face_height == 0:
            return 0.0

        # === Mouth landmarks ===
        upper_lip = landmarks[13]
        lower_lip = landmarks[14]
        left_corner = landmarks[61]
        right_corner = landmarks[291]

        # Nose tip as reference (landmark 4)
        nose_tip = landmarks[4]

        # === Normalized measurements ===

        # 1. Mouth width relative to face width (normally ~0.4-0.5)
        mouth_width = np.sqrt(
            (right_corner.x - left_corner.x)**2 +
            (right_corner.y - left_corner.y)**2
        )
        mouth_width_ratio = mouth_width / face_width

        # 2. Mouth corner angle relative to mouth center
        # When smiling, corners pull UP and OUT
        mouth_center_y = (upper_lip.y + lower_lip.y) / 2
        left_corner_rise = mouth_center_y - left_corner.y
        right_corner_rise = mouth_center_y - right_corner.y

        # Normalize by face height
        left_rise_normalized = left_corner_rise / face_height
        right_rise_normalized = right_corner_rise / face_height
        avg_rise = (left_rise_normalized + right_rise_normalized) / 2

        # 3. Cheek raise indicator (AU6) - distance from eye to cheek
        # Landmark 117 (left cheek), 346 (right cheek)
        left_cheek = landmarks[117]
        right_cheek = landmarks[346]
        left_eye_lower = landmarks[145]
        right_eye_lower = landmarks[374]

        left_cheek_dist = np.sqrt(
            (left_cheek.x - left_eye_lower.x)**2 +
            (left_cheek.y - left_eye_lower.y)**2
        )
        right_cheek_dist = np.sqrt(
            (right_cheek.x - right_eye_lower.x)**2 +
            (right_cheek.y - right_eye_lower.y)**2
        )
        avg_cheek_dist = (left_cheek_dist + right_cheek_dist) / 2
        cheek_raise = 1.0 - (avg_cheek_dist / face_height * 5)  # Inverted: smaller = more smile

        # 4. Lip thickness change (lips thin when smiling wide)
        lip_thickness = np.sqrt(
            (upper_lip.x - lower_lip.x)**2 +
            (upper_lip.y - lower_lip.y)**2
        )
        lip_thin_ratio = 1.0 - (lip_thickness / face_height * 10)

        # === Combine signals with thresholds ===
        # These thresholds are calibrated for "neutral = 0%"

        # Mouth width: neutral ~0.45, smile ~0.55+
        width_score = max(0, (mouth_width_ratio - 0.45) / 0.15)

        # Corner rise: neutral ~0, smile > 0.01
        rise_score = max(0, avg_rise / 0.025)

        # Cheek raise: 0-1 scale
        cheek_score = max(0, min(1, cheek_raise))

        # Combine with weights
        # Rise is most important, then width, then cheek
        smile_probability = (
            rise_score * 0.50 +      # Corner rise (most reliable)
            width_score * 0.30 +     # Mouth width
            cheek_score * 0.20       # Cheek raise (AU6)
        )

        # Apply threshold: below 0.15 = not smiling
        if smile_probability < 0.15:
            smile_probability = 0.0
        else:
            # Scale remaining range to 0-1
            smile_probability = (smile_probability - 0.15) / 0.85

        return float(min(1.0, max(0.0, smile_probability)))

    except Exception as e:
        print(f"Landmark smile calculation error: {e}")
        return 0.0

@app.on_event("startup")
async def startup_event():
    init_face_landmarker()
    init_face_detector()
    load_au_model()

@app.get("/")
async def root():
    return {
        "message": "FacePsy Web API",
        "status": "running",
        "model_loaded": interpreter is not None,
        "face_landmarker_loaded": face_landmarker is not None,
        "face_mesh_loaded": face_mesh is not None,
        "face_detector_loaded": face_detector is not None
    }

@app.post("/analyze")
async def analyze_face(file: UploadFile = File(...)):
    """Analyze face from uploaded image"""
    try:
        # Read image
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image")

        return await process_image(image)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/analyze-base64")
async def analyze_face_base64(data: dict):
    """Analyze face from base64 encoded image"""
    try:
        # Get base64 image
        image_data = data.get("image", "")
        if not image_data:
            raise HTTPException(status_code=400, detail="No image data provided")

        # Remove data URL prefix if present
        if "base64," in image_data:
            image_data = image_data.split("base64,")[1]

        # Decode base64
        image_bytes = base64.b64decode(image_data)
        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image")

        return await process_image(image)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

async def process_image(image):
    """Process image and return analysis results"""
    global face_landmarker, face_mesh, face_detector

    if face_landmarker is None and face_mesh is None and face_detector is None:
        return JSONResponse(content={
            "success": False,
            "message": "Face landmarker not initialized",
            "data": None
        })

    # Convert BGR to RGB
    rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    face_landmarks = None
    blendshapes = None
    transformation_matrixes = None
    bbox = None

    if face_landmarker is not None:
        # Create MediaPipe Image
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_image)

        # Detect face landmarks
        detection_result = face_landmarker.detect(mp_image)

        if not detection_result.face_landmarks:
            return JSONResponse(content={
                "success": False,
                "message": "No face detected",
                "data": None
            })

        # Get first face
        face_landmarks = detection_result.face_landmarks[0]
        blendshapes = detection_result.face_blendshapes[0] if detection_result.face_blendshapes else None
        transformation_matrixes = detection_result.facial_transformation_matrixes
    elif face_mesh is not None:
        # Fallback to FaceMesh (CPU-only)
        results = face_mesh.process(rgb_image)
        if not results.multi_face_landmarks:
            return JSONResponse(content={
                "success": False,
                "message": "No face detected",
                "data": None
            })
        face_landmarks = results.multi_face_landmarks[0].landmark
    elif face_detector is not None:
        # Final fallback: OpenCV Haar cascade
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        faces = face_detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80))
        if len(faces) == 0:
            return JSONResponse(content={
                "success": False,
                "message": "No face detected",
                "data": None
            })
        # Use largest detected face
        x, y, w_box, h_box = max(faces, key=lambda f: f[2] * f[3])
        bbox = (x, y, x + w_box, y + h_box)

    h, w = image.shape[:2]

    if bbox is None:
        # Get bounding box from landmarks
        x_coords = [lm.x * w for lm in face_landmarks]
        y_coords = [lm.y * h for lm in face_landmarks]

        x_min, x_max = int(min(x_coords)), int(max(x_coords))
        y_min, y_max = int(min(y_coords)), int(max(y_coords))

        # Add padding
        padding = 20
        x_min = max(0, x_min - padding)
        y_min = max(0, y_min - padding)
        x_max = min(w, x_max + padding)
        y_max = min(h, y_max + padding)
    else:
        x_min, y_min, x_max, y_max = bbox

    # Head pose from transformation matrix
    head_pose = None
    if transformation_matrixes:
        matrix = np.array(transformation_matrixes[0])
        head_pose = calculate_head_pose_from_matrix(matrix)

    # Eye analysis from blendshapes
    left_eye_openness = 0.5
    right_eye_openness = 0.5
    smile_from_blendshapes = 0.0

    if blendshapes:
        for bs in blendshapes:
            name_lower = bs.category_name.lower()

            # Eye blink detection
            if "eyeblinkleft" in name_lower or "eye_blink_left" in name_lower:
                left_eye_openness = 1.0 - bs.score
            elif "eyeblinkright" in name_lower or "eye_blink_right" in name_lower:
                right_eye_openness = 1.0 - bs.score

            # Smile detection from various blendshape names
            if any(s in name_lower for s in ["smile", "mouthsmile", "mouth_smile", "jawopen"]):
                if "smile" in name_lower:
                    smile_from_blendshapes = max(smile_from_blendshapes, bs.score)
                elif "jawopen" in name_lower:
                    # Jaw open contributes partially to smile
                    smile_from_blendshapes = max(smile_from_blendshapes, bs.score * 0.3)

    # Calculate smile from landmarks as backup
    smile_from_landmarks = calculate_smile_from_landmarks(face_landmarks) if face_landmarks else 0.0

    # Crop face for AU detection
    face_crop = image[y_min:y_max, x_min:x_max]
    au_results = detect_action_units(face_crop)

    # Get AU12 (Lip Corner Puller) for smile indication
    smile_from_au12 = 0.0
    if au_results:
        for name, value in au_results.items():
            if "AU12" in name:
                smile_from_au12 = value
                break

    # Combine all smile signals (weighted average)
    # Priority: blendshapes > AU12 > landmarks
    if smile_from_blendshapes > 0.1:
        smile_probability = smile_from_blendshapes
    elif smile_from_au12 > 0.1:
        smile_probability = smile_from_au12
    else:
        smile_probability = smile_from_landmarks

    # Ensure it's in valid range
    smile_probability = float(min(1.0, max(0.0, smile_probability)))

    # Prepare response
    response_data = {
        "success": True,
        "message": "Face analyzed successfully",
        "data": {
            "face_detected": True,
            "bounding_box": {
                "x": x_min,
                "y": y_min,
                "width": x_max - x_min,
                "height": y_max - y_min
            },
            "head_pose": head_pose,
            "eye_analysis": {
                "left_eye_openness": float(left_eye_openness),
                "right_eye_openness": float(right_eye_openness),
                "average_openness": float((left_eye_openness + right_eye_openness) / 2)
            },
            "expressions": {
                "smile_probability": smile_probability,
                "smile_details": {
                    "from_blendshapes": float(smile_from_blendshapes),
                    "from_au12": float(smile_from_au12),
                    "from_landmarks": float(smile_from_landmarks)
                }
            },
            "action_units": au_results,
            "landmarks_count": len(face_landmarks) if face_landmarks else 0
        }
    }

    return JSONResponse(content=response_data)

if __name__ == "__main__":
    import uvicorn
    # Use localhost to avoid binding restrictions on some environments.
    uvicorn.run(app, host="127.0.0.1", port=8000)

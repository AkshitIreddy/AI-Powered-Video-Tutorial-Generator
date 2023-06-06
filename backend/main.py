from fastapi import FastAPI, HTTPException, Request, Depends, File
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from functions.video_main_function import video_main

app = FastAPI()
security = HTTPBasic()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/videoCreate")
async def create_insights(request: Request, credentials: HTTPBasicCredentials = Depends(security)):
    if credentials.username != "myusername" or credentials.password != "mypassword":
        raise HTTPException(status_code=401, detail="Invalid credentials")
    data = await request.json()
    message = data['message']
    level = data['level']
    age = data['age']
    creative = data['creative']
    humour = data['humour']
    characterName = data['characterName']

    path = video_main_function(message, level, age, creative, humour, characterName)
    return FileResponse(path, media_type="video/mp4")

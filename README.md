# AI-Generated Video Tutorials with Character Animation and Slides! 🎥🤖📝🎨

This project empowers you to create captivating and informative AI-generated video tutorials! With a charming character featuring facial animation and informative slides, you can explain any topic with ease. The best part? You have full control over the tutorial's creativity, humor, level of explanation, character appearance, and voice. ❤️✨

Give it a try for free! 🔥 It leverages the powerful capabilities of various tools.

# 🚀 Features
- 🧠 The script is generated using Cohere's language model. (You can obtain a trial API key for free!)
- 🗣️ Seamless integration with Edge TTS for high-quality voiceovers.
- 😄 Engaging facial animation powered by SadTalker.
- 🖼️ Eye-catching and relevant images from Google for slides.
- 🎨 Customizable creativity, humor, explanation level, character appearance, and voice.

# ✨ Quick Demo


https://github.com/AkshitIreddy/AI-Powered-Video-Tutorial-Generator/assets/90443032/0a1fb05a-8290-4391-b329-96f04dcae7a1


# ✨ Full Demo


https://github.com/AkshitIreddy/AI-Powered-Video-Tutorial-Generator/assets/90443032/9eb78053-dd53-4fac-b0da-6139e21943e8


https://github.com/AkshitIreddy/AI-Powered-Video-Tutorial-Generator/assets/90443032/b933a178-e8c1-4660-8b60-74a8d29faa2e


# 🚨 Requirements
Open up a terminal and go to backend directory
```sh
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```
Also install sadtalker(https://github.com/OpenTalker/SadTalker#%EF%B8%8F-1-installation), the sadtalker directory must be inside backend. Run the sadtalker webui once so that the venv environment is created.

# 🔌 How to use

Open up a terminal and go to frontend/topic2explanation
```sh
npm run dev
```
Open up another terminal and go to backend
```sh
uvicorn main:app
```

# 🎨 Customizability 
To change the character and voice, you need to put your desired character in characters directory. It must be in 640x720 resolution and for the voice you can choose a voice from the voice list which can be seen using this command.

```sh
edge-tts --list-voices
```

Once you find a voice you like add it in the create_audio_image function 
```sh
    character_dict = {'Benjamin': "en-GB-RyanNeural",
                      'Sophia': 'en-IE-EmilyNeural'}
``` 


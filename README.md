# AI-Generated Video Tutorials with Character Animation and Slides! 🎥🤖📝🎨

This AI tool helps you create captivating and informative AI-generated video tutorials on any topic! With a charming character featuring facial animation and informative slides, it can explain any topic with ease. The best part? You have full control over the tutorial's creativity, humor, level of explanation, character appearance, and voice. ❤️✨

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
For Windows
```sh
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```
For Linux\Mac
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

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
Add your Cohere API key to apikeys.json

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

# 📝 How it works
✨ It all starts with the creation of a script using the create_script function. 📜 This function takes various parameters such as topic, level of explanation, target audience age, creativity, and humor. 🎭 With these parameters in mind, the script is carefully crafted to explain the chosen topic. To accomplish this, we leverage the power of the Cohere API and Langchain. 🤝

🎙️ Once the script is ready, we move on to the create_audio_image function. This function splits the script into smaller sentences, which are then used to generate audio dialogues using Microsoft's Edge Text-to-Speech (TTS) service. 🗣️ In parallel, we generate a search query for each sentence using Cohere and Langchain once again. These search queries help us retrieve relevant images from Google, which will be used as slides in the presentation. 🖼️

🎥 With the audio files and character images in place, we proceed to create the videos using the Sadtalker library. 🎬 First, we generate videos for the character animations, and then we transform the still images from Google into slide videos. 🎞️ These slide videos will be seamlessly integrated into the final video presentation. To add an element of randomness, we assign a random number to each video and slide pair. Based on this number, we position the slides and talking character either to the left or right, or even use the image as the background. The talking character may appear in the bottom left or right corner of the screen. 🎯

📼 Finally, we save the completed video, combining the slide videos and character animation videos. The resulting video is now ready to be shared! 🎉 To bring it all together, we rely on FastAPI for the backend, and for the frontend, we utilize Next.js and Tailwind CSS. 🚀

# ❤️ Thanks
If you found this interesting check out Alystria AI for more fun projects
```sh
https://www.linkedin.com/company/alystria-ai
```

- 🌐 Github: https://github.com/AkshitIreddy
- 💡 LinkedIn: https://www.linkedin.com/in/akshit-ireddy
- ✍️ Medium: https://medium.com/@akshit.r.ireddy
- 🐤 Twitter: https://twitter.com/akshit_ireddy


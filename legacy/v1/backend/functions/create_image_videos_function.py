from moviepy.editor import *
import os
import re


def create_image_videos(timestamp):

    image_folder = f"{timestamp}/images"
    audio_folder = f"{timestamp}/audio"
    output_folder = f"{timestamp}/image_videos"

    image_files = os.listdir(image_folder)

    # Sort image files based on numeric part of file name
    image_files.sort(key=lambda x: int(re.search(r'\d+', x).group()))

    for image_file in image_files:
        image_path = os.path.join(image_folder, image_file)
        audio_file = os.path.join(
            audio_folder, f"{image_file.split('.')[0]}.wav")

        audio_duration = AudioFileClip(audio_file).duration

        # Load the audio clip and make it silent
        audio_clip = AudioFileClip(audio_file).volumex(0)

        # Load the image clip
        image_clip = ImageClip(image_path, duration=audio_duration)

        # Combine the image and audio clips
        video_clip = image_clip.set_audio(audio_clip)

        # Split the image file name to get the video clip name
        video_clip_name = os.path.splitext(image_file)[0]

        # Set the output path for the video clip
        output_path = os.path.join(output_folder, f"{video_clip_name}.mp4")

        # Write the video clip to the output path
        video_clip.write_videofile(output_path, codec="libx264", fps=25)

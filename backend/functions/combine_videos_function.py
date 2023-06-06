import os
import random
from moviepy.editor import *


def combine_videos(timestamp):

    video1_folder = f"{timestamp}/video"
    video2_folder = f"{timestamp}/image_videos"

    # Sort video files based on numeric part of file name
    video1_files = sorted(os.listdir(video1_folder),
                          key=lambda x: int(x.split(".")[0]))
    video2_files = sorted(os.listdir(video2_folder),
                          key=lambda x: int(x.split(".")[0]))

    clips = []
    for i in range(len(video1_files)):
        # Load video clips
        video1 = VideoFileClip(os.path.join(video1_folder, video1_files[i]))
        video2 = VideoFileClip(os.path.join(video2_folder, video2_files[i]))

        # Resize videos based on scenario
        scenario = random.randint(1, 4)
        if scenario in [1, 2]:
            video1 = video1.resize((640, 720))
            video2 = video2.resize((640, 720))
        elif scenario in [3, 4]:
            video1 = video1.resize((320, 360))
            video2 = video2.resize((1280, 720))

        # Combine videos based on scenario
        if scenario == 1:
            final_clip = clips_array([[video1, video2]])
        elif scenario == 2:
            final_clip = clips_array([[video2, video1]])
        elif scenario == 3:
            final_clip = CompositeVideoClip(
                [video2, video1.set_position((0, 0.5), relative=True)], use_bgclip=True)
        elif scenario == 4:
            final_clip = CompositeVideoClip(
                [video2, video1.set_position((0.75, 0.5), relative=True)], use_bgclip=True)

        clips.append(final_clip)

    final_clip = concatenate_videoclips(clips)
    final_clip.write_videofile(
        f"{timestamp}/final_video.mp4", codec="libx264", fps=25)

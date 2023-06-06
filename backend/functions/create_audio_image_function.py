from langchain.text_splitter import RecursiveCharacterTextSplitter
from functions.create_search_query_function import create_search_query
from functions.create_speech_function import create_speech
from functions.get_image_function import get_image


def create_audio_image(script, character_name, timestamp):

    character_dict = {'Benjamin': "en-GB-RyanNeural",
                      'Sophia': 'en-IE-EmilyNeural'}

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=150,
        chunk_overlap=0,
        length_function=len,
    )

    list = text_splitter.split_text(script)
    search_dict = {}
    count = 0
    for i in list:
        create_speech(i, f'{timestamp}/audio/{count}.wav',
                      character_dict[character_name])
        search_query = create_search_query(i).lstrip()
        if search_query in search_dict:
            search_dict[search_query] += 1
        else:
            search_dict[search_query] = 1
        count = count + 1

    count = 0
    for key, value in search_dict.items():
        get_image(key, value, timestamp, count)
        count = count + value

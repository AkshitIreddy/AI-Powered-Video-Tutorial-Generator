import json
import random
from langchain.llms import Cohere
from langchain import PromptTemplate, LLMChain


def create_search_query(text):
    # Randomly select an API key
    selected_key = json.load(open('apikeys.json', 'r'))['api_keys'][random.randint(
        0, len(json.load(open('apikeys.json', 'r'))['api_keys'])-1)]

    # Initialise model
    llm = Cohere(cohere_api_key=selected_key,
                 model='command-xlarge-beta', temperature=1.2, max_tokens=100, stop=['\n\n'])

    # create the template string
    template = """Instructions:\nCreate a search query for the text to get relevant images.\n\nText: Quantum computing is a multidisciplinary field comprising aspects of computer science, physics, and mathematics that utilizes quantum mechanics to solve complex problems faster than on classical computers.\nSearch Query: Quantum Computing\n\nText: {text}\nSearch Query:"""

    # create prompt
    prompt = PromptTemplate(template=template, input_variables=["text"])

    # Create and run the llm chain
    llm_chain = LLMChain(prompt=prompt, llm=llm)
    response = llm_chain.run(text=text).replace('\n', "")

    return response

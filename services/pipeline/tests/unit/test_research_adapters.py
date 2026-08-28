from __future__ import annotations

import json
import unittest

from alystria.research import (
    AcademicWork,
    ArxivAdapter,
    CrossrefAdapter,
    DataCiteAdapter,
    EuropePmcAdapter,
    MockAcademicAdapter,
    OpenAlexAdapter,
    OpenCitationsAdapter,
    ResearchCoordinator,
    ResearchHttpClient,
    ResearchQuestion,
)
from alystria.sources import HttpResponse


class QueueTransport:
    def __init__(self, *bodies: bytes) -> None:
        self.bodies = list(bodies)
        self.urls: list[str] = []

    def get(self, url: str, *, headers=None) -> HttpResponse:
        self.urls.append(url)
        return HttpResponse(url, 200, {"content-type": "application/json"}, self.bodies.pop(0))


class ResearchAdapterTests(unittest.TestCase):
    def client(self, payload: object) -> tuple[ResearchHttpClient, QueueTransport]:
        transport = QueueTransport(json.dumps(payload).encode())
        return ResearchHttpClient(transport), transport

    def test_openalex_normalizes_work(self) -> None:
        client, transport = self.client({"results": [{
            "id": "https://openalex.org/W1", "display_name": "Karatsuba algorithm",
            "authorships": [{"author": {"display_name": "A. Author"}}],
            "publication_date": "1962-01-01", "ids": {"doi": "https://doi.org/10/x"},
            "primary_location": {"pdf_url": "https://example.org/paper.pdf"}, "cited_by_count": 12,
        }]})
        work = OpenAlexAdapter(client).search("karatsuba", limit=1)[0]
        self.assertEqual(work.authors, ("A. Author",))
        self.assertEqual(work.citation_count, 12)
        self.assertIn("search=karatsuba", transport.urls[0])

    def test_crossref_normalizes_doi(self) -> None:
        client, _ = self.client({"message": {"items": [{
            "DOI": "10.1/demo",
            "title": ["Demo"],
            "author": [{"given": "Ada", "family": "Lovelace"}],
            "published": {"date-parts": [[2020, 2, 3]]}, "URL": "https://doi.org/10.1/demo",
        }]}})
        work = CrossrefAdapter(client).search("demo")[0]
        self.assertEqual(work.identifiers["doi"], "10.1/demo")
        self.assertEqual(work.published, "2020-02-03")

    def test_datacite_normalizes_dataset(self) -> None:
        client, _ = self.client({"data": [{"id": "10.2/data", "attributes": {
            "doi": "10.2/data", "titles": [{"title": "Dataset"}],
            "creators": [{"name": "Researcher"}], "publicationYear": 2025,
            "descriptions": [{"description": "Useful data"}],
        }}]})
        work = DataCiteAdapter(client).search("dataset")[0]
        self.assertEqual(work.title, "Dataset")
        self.assertEqual(work.abstract, "Useful data")

    def test_opencitations_encodes_identifier(self) -> None:
        client, transport = self.client(
            [{"citing": "doi:10.3/citer", "cited": "doi:10.2/work", "creation": "2024"}]
        )
        work = OpenCitationsAdapter(client).search("doi:10.2/work")[0]
        self.assertEqual(work.identifiers["doi"], "10.3/citer")
        self.assertIn("doi:10.2%2Fwork", transport.urls[0])

    def test_europe_pmc_normalizes_open_access_record(self) -> None:
        client, _ = self.client({"resultList": {"result": [{
            "pmcid": "PMC123", "pmid": "123", "source": "MED", "title": "Biomedical work",
            "authorString": "A One, B Two.",
            "firstPublicationDate": "2024-01-02",
            "isOpenAccess": "Y",
        }]}})
        work = EuropePmcAdapter(client).search("health")[0]
        self.assertEqual(work.provider_id, "PMC123")
        self.assertEqual(work.authors, ("A One", "B Two"))
        self.assertIsNotNone(work.open_access_url)

    def test_arxiv_parses_atom_safely(self) -> None:
        atom = b'''<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
          <id>https://arxiv.org/abs/1234.5678</id><updated>2025-01-02T00:00:00Z</updated>
          <published>2025-01-01T00:00:00Z</published><title>  A useful paper </title>
          <summary> A clear summary. </summary><author><name>Ada</name></author>
          <link title="pdf" href="https://arxiv.org/pdf/1234.5678" />
        </entry></feed>'''
        transport = QueueTransport(atom)
        work = ArxivAdapter(ResearchHttpClient(transport)).search("paper")[0]
        self.assertEqual(work.provider_id, "1234.5678")
        self.assertEqual(work.title, "A useful paper")
        self.assertEqual(work.authors, ("Ada",))

    def test_mock_adapter_is_offline_and_deterministic(self) -> None:
        works = [AcademicWork("mock", "1", "Karatsuba", "local://1", abstract="multiplication")]
        adapter = MockAcademicAdapter(works)
        self.assertEqual(adapter.search("multiply"), adapter.search("multiply"))
        self.assertEqual(adapter.search("karatsuba")[0].provider_id, "1")

    def test_research_coordinator_deduplicates_and_fuses_provider_ranks(self) -> None:
        shared_a = AcademicWork(
            "first",
            "a",
            "Shared work",
            "https://doi.org/10.1/shared",
            identifiers={"doi": "10.1/shared"},
        )
        shared_b = AcademicWork(
            "second",
            "b",
            "Shared work duplicate",
            "https://example.org/b",
            identifiers={"doi": "10.1/shared"},
        )
        unique = AcademicWork("second", "c", "Unique work", "https://example.org/c")

        class StaticAdapter:
            def __init__(self, name, works):
                self.name = name
                self.works = works

            def search(self, query, *, limit=10):
                return self.works[:limit]

        coordinator = ResearchCoordinator([
            StaticAdapter("first", [shared_a]),
            StaticAdapter("second", [unique, shared_b]),
        ])
        hits = coordinator.research(ResearchQuestion.create("Which work is strongest?"))
        self.assertEqual(len(hits), 2)
        self.assertEqual(hits[0].work.title, "Shared work")
        self.assertEqual(hits[0].providers, ("first", "second"))


if __name__ == "__main__":
    unittest.main()

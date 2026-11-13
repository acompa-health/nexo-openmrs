package org.openmrs.module.nexo.web;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.openmrs.api.context.Context;
import org.openmrs.module.nexo.api.NexoEventLog;
import org.openmrs.module.nexo.api.NexoEventLog.DuplicateException;
import org.openmrs.module.nexo.api.NexoEventLog.NewEntry;
import org.openmrs.module.nexo.api.NexoEventLog.StaleException;
import org.openmrs.module.nexo.api.NexoEventLog.Stored;
import org.openmrs.util.PrivilegeConstants;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

/**
 * {@code GET} and {@code POST /ws/rest/v1/nexo/patients/{patientUuid}/log}: read and append a patient's Nexo event
 * log. The server checks the shape of each entry and the append order. It does not check the clinical content.
 */
@Controller
@RequestMapping(NexoController.BASE + "/patients/{patientUuid}/log")
public class NexoLogController extends NexoController {

	/** The most entries that one append may carry. */
	static final int MAX_ENTRIES = 100;

	private static final Pattern UUID_LIKE = Pattern.compile("[A-Za-z0-9-]{1,38}");

	@Autowired
	@Qualifier("nexo.eventLog")
	private NexoEventLog eventLog;

	@RequestMapping(method = RequestMethod.GET)
	public void read(@PathVariable("patientUuid") String patientUuid, HttpServletResponse response) throws IOException {
		requirePrivilege(PrivilegeConstants.GET_ENCOUNTERS);
		if (!UUID_LIKE.matcher(patientUuid).matches()) {
			writeError(response, 400, "invalid", "The patient UUID is not valid.");
			return;
		}
		ObjectNode body = MAPPER.createObjectNode().put("patient", patientUuid);
		ArrayNode entries = body.putArray("entries");
		for (Stored stored : eventLog.list(patientUuid)) {
			ObjectNode entry = (ObjectNode) MAPPER.readTree(stored.json);
			entry.put("seq", stored.seq);
			entries.add(entry);
		}
		writeJson(response, 200, body);
	}

	@RequestMapping(method = RequestMethod.POST)
	public void append(@PathVariable("patientUuid") String patientUuid, HttpServletRequest request,
	        HttpServletResponse response) throws IOException {
		requirePrivilege(PrivilegeConstants.ADD_ENCOUNTERS);
		if (!UUID_LIKE.matcher(patientUuid).matches()) {
			writeError(response, 400, "invalid", "The patient UUID is not valid.");
			return;
		}
		JsonNode body;
		try {
			body = MAPPER.readTree(request.getInputStream());
		}
		catch (JsonProcessingException e) {
			writeError(response, 400, "invalid", "The body is not valid JSON.");
			return;
		}
		if (body == null || !body.isObject()) {
			writeError(response, 400, "invalid", "The body must be an object with expectedSeq and entries.");
			return;
		}
		JsonNode expectedNode = body.get("expectedSeq");
		if (expectedNode == null || !expectedNode.isIntegralNumber() || !expectedNode.canConvertToInt()
		        || expectedNode.intValue() < 0) {
			writeError(response, 400, "invalid", "expectedSeq must be a whole number, 0 or more.");
			return;
		}
		int expectedSeq = expectedNode.intValue();
		JsonNode list = body.get("entries");
		if (list == null || !list.isArray() || list.size() == 0 || list.size() > MAX_ENTRIES) {
			writeError(response, 400, "invalid", "entries must be an array of 1 to " + MAX_ENTRIES + " entries.");
			return;
		}

		List<NewEntry> rows = new ArrayList<NewEntry>();
		ArrayNode stored = MAPPER.createArrayNode();
		Set<String> eventIds = new HashSet<String>();
		for (int i = 0; i < list.size(); i++) {
			JsonNode node = list.get(i);
			String problem = checkEntry(node, patientUuid);
			if (problem != null) {
				writeError(response, 400, "invalid", "entries[" + i + "]: " + problem);
				return;
			}
			ObjectNode entry = (ObjectNode) node;
			JsonNode event = entry.get("event");
			String eventId = event.get("id").textValue();
			if (!eventIds.add(eventId)) {
				writeJson(response, 409, MAPPER.createObjectNode().put("error", "duplicate").put("event", eventId));
				return;
			}
			entry.put("seq", expectedSeq + i);
			JsonNode encounter = entry.get("encounter");
			rows.add(new NewEntry(entry.get("kind").textValue(), eventId, event.get("type").textValue(),
			        event.get("occurred_at").textValue(), encounter == null || encounter.isNull() ? null : encounter
			                .textValue(), protocolIdentity(entry), MAPPER.writeValueAsString(entry)));
			stored.add(entry);
		}

		try {
			eventLog.append(patientUuid, expectedSeq, rows, Context.getAuthenticatedUser().getUserId());
		}
		catch (StaleException e) {
			int count = e.count >= 0 ? e.count : eventLog.count(patientUuid);
			writeJson(response, 409, MAPPER.createObjectNode().put("error", "stale").put("count", count));
			return;
		}
		catch (DuplicateException e) {
			writeJson(response, 409, MAPPER.createObjectNode().put("error", "duplicate").put("event", e.eventId));
			return;
		}
		ObjectNode out = MAPPER.createObjectNode().put("patient", patientUuid);
		out.set("entries", stored);
		writeJson(response, 200, out);
	}

	/** Returns the first shape problem of one entry, or null. Column limits come from liquibase.xml. */
	static String checkEntry(JsonNode entry, String patientUuid) {
		if (entry == null || !entry.isObject()) {
			return "an entry must be an object";
		}
		String kind = entry.path("kind").textValue();
		if (!"launch".equals(kind) && !"event".equals(kind)) {
			return "kind must be \"launch\" or \"event\"";
		}
		JsonNode event = entry.get("event");
		if (event == null || !event.isObject()) {
			return "event must be an object";
		}
		String problem = checkText(event.get("id"), "event.id", 255, true);
		if (problem == null) {
			problem = checkText(event.get("type"), "event.type", 100, true);
		}
		if (problem == null) {
			problem = checkText(event.get("occurred_at"), "event.occurred_at", 40, true);
		}
		if (problem == null) {
			problem = checkText(entry.get("encounter"), "encounter", 38, false);
		}
		if (problem == null && "launch".equals(kind)) {
			if (!entry.path("execution").isObject()) {
				problem = "a launch entry needs an execution object";
			} else if (!entry.path("objects").isArray()) {
				problem = "a launch entry needs an objects array";
			} else if (!patientUuid.equals(entry.path("execution").path("subject").path("id").textValue())) {
				problem = "the launch execution's subject is not the patient in the path";
			}
		}
		// The log is append-only, so an entry for another patient could never be removed from this one.
		if (problem == null && !patientUuid.equals(event.path("scope").path("patient").textValue())) {
			problem = "event.scope.patient is not the patient in the path";
		}
		if (problem == null) {
			String identity = protocolIdentity(entry);
			if (identity != null && identity.length() > 120) {
				problem = "the protocol identity is longer than 120 characters";
			}
		}
		return problem;
	}

	private static String checkText(JsonNode value, String name, int max, boolean required) {
		if (value == null || value.isNull()) {
			return required ? name + " is required" : null;
		}
		if (!value.isTextual() || (required && value.textValue().isEmpty())) {
			return name + " must be a non-empty string";
		}
		if (value.textValue().length() > max) {
			return name + " is longer than " + max + " characters";
		}
		return null;
	}

	/** The content identity that the entry names: the launched execution's, else the event target's. */
	private static String protocolIdentity(JsonNode entry) {
		JsonNode identity = entry.path("execution").path("content").path("identity");
		if (!identity.isTextual()) {
			identity = entry.path("event").path("target").path("content").path("identity");
		}
		return identity.isTextual() ? identity.textValue() : null;
	}
}

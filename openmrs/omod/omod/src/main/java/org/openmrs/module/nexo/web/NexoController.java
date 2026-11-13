package org.openmrs.module.nexo.web;

import java.io.IOException;

import javax.servlet.http.HttpServletResponse;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.cfg.JsonNodeFeature;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.openmrs.api.APIAuthenticationException;
import org.openmrs.api.context.Context;
import org.openmrs.module.webservices.rest.web.RestConstants;
import org.openmrs.module.webservices.rest.web.v1_0.controller.BaseRestController;

/**
 * Shared parts of the Nexo endpoints. The handlers write JSON with Jackson themselves, so the stored entries go out
 * as they came in. BaseRestController turns {@link APIAuthenticationException} into 401 (not logged in) or 403
 * (missing privilege).
 */
abstract class NexoController extends BaseRestController {

	static final String BASE = "/rest/" + RestConstants.VERSION_1 + "/nexo";

	/** Keeps decimal numbers exact, so a stored entry reads back with the same values. */
	static final ObjectMapper MAPPER = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
	        .configure(JsonNodeFeature.STRIP_TRAILING_BIGDECIMAL_ZEROES, false);

	static void requirePrivilege(String privilege) {
		if (!Context.isAuthenticated()) {
			throw new APIAuthenticationException("Log in to use the Nexo endpoints");
		}
		if (!Context.hasPrivilege(privilege)) {
			throw new APIAuthenticationException("Privilege required: " + privilege);
		}
	}

	static void writeJson(HttpServletResponse response, int status, JsonNode body) throws IOException {
		response.setStatus(status);
		response.setContentType("application/json");
		response.setCharacterEncoding("UTF-8");
		MAPPER.writeValue(response.getOutputStream(), body);
	}

	static void writeError(HttpServletResponse response, int status, String error, String message) throws IOException {
		ObjectNode body = MAPPER.createObjectNode().put("error", error);
		if (message != null) {
			body.put("message", message);
		}
		writeJson(response, status, body);
	}

	@Override
	public String getNamespace() {
		return RestConstants.VERSION_1 + "/nexo";
	}
}

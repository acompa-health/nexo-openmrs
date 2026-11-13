package org.openmrs.module.nexo.web;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Arrays;

import javax.servlet.http.HttpServletResponse;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.openmrs.util.OpenmrsUtil;
import org.openmrs.util.PrivilegeConstants;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

/**
 * {@code GET /ws/rest/v1/nexo/protocols[/{name}/bundle|binding]}: lists and serves the protocol files that the build
 * step writes to {@code <application data>/configuration/nexo/<name>/}. The server does not change or check them.
 */
@Controller
@RequestMapping(NexoController.BASE + "/protocols")
public class NexoProtocolController extends NexoController {

	private static final Logger log = LoggerFactory.getLogger(NexoProtocolController.class);

	static final String BUNDLE = "protocol.json";

	static final String BINDING = "binding.json";

	@RequestMapping(method = RequestMethod.GET)
	public void list(HttpServletResponse response) throws IOException {
		requirePrivilege(PrivilegeConstants.GET_ENCOUNTERS);
		ArrayNode out = MAPPER.createArrayNode();
		File[] folders = protocolsDir().listFiles(File::isDirectory);
		if (folders != null) {
			Arrays.sort(folders);
			for (File folder : folders) {
				File bundle = new File(folder, BUNDLE);
				if (!bundle.isFile()) {
					continue;
				}
				JsonNode content = readContent(bundle);
				ObjectNode item = out.addObject().put("name", folder.getName());
				item.set("id", content.path("protocol").isTextual() ? content.get("protocol") : null);
				item.set("revision", content.path("revision").isTextual() ? content.get("revision") : null);
				item.set("identity", content.path("identity").isTextual() ? content.get("identity") : null);
			}
		}
		writeJson(response, 200, out);
	}

	@RequestMapping(value = "/{name}/bundle", method = RequestMethod.GET)
	public void bundle(@PathVariable("name") String name, HttpServletResponse response) throws IOException {
		serve(name, BUNDLE, response);
	}

	@RequestMapping(value = "/{name}/binding", method = RequestMethod.GET)
	public void binding(@PathVariable("name") String name, HttpServletResponse response) throws IOException {
		serve(name, BINDING, response);
	}

	private static void serve(String name, String fileName, HttpServletResponse response) throws IOException {
		requirePrivilege(PrivilegeConstants.GET_ENCOUNTERS);
		if (!isSafeName(name)) {
			writeError(response, 400, "invalid", "The protocol name must be one folder name.");
			return;
		}
		File file = new File(new File(protocolsDir(), name), fileName);
		if (!file.isFile()) {
			writeError(response, 404, "not_found", "No " + fileName + " for protocol " + name + ".");
			return;
		}
		response.setStatus(200);
		response.setContentType("application/json");
		response.setCharacterEncoding("UTF-8");
		response.setHeader("Cache-Control", "no-cache");
		Files.copy(file.toPath(), response.getOutputStream());
	}

	static boolean isSafeName(String name) {
		return name != null && !name.isEmpty() && !name.contains("/") && !name.contains("\\") && !name.contains("..");
	}

	static File protocolsDir() {
		return new File(new File(OpenmrsUtil.getApplicationDataDirectory(), "configuration"), "nexo");
	}

	/**
	 * Reads only the top-level {@code content} object of a bundle. The parser stops there, so a large bundle is not
	 * loaded into memory. Returns a missing node when the file has no readable {@code content}.
	 */
	static JsonNode readContent(File bundle) {
		try (JsonParser parser = MAPPER.getFactory().createParser(bundle)) {
			if (parser.nextToken() != JsonToken.START_OBJECT) {
				return MAPPER.missingNode();
			}
			while (parser.nextToken() == JsonToken.FIELD_NAME) {
				String field = parser.currentName();
				parser.nextToken();
				if ("content".equals(field)) {
					JsonNode content = MAPPER.readTree(parser);
					return content == null ? MAPPER.missingNode() : content;
				}
				parser.skipChildren();
			}
		}
		catch (IOException e) {
			log.warn("Cannot read the content of {}: {}", bundle, e.getMessage());
		}
		return MAPPER.missingNode();
	}
}
